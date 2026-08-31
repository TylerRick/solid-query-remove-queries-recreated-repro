import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/solid-query';
import { render, screen } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';

/**
 * SUBJECT: does `removeQueries()` stay removed when the entry is ACTIVELY OBSERVED — and if it
 * does not, is the value that comes back the RETAINED old value or a fresh refetch?
 *
 * One prefetched entry, one mounted `useQuery` observing it, then `cancelQueries()` +
 * `removeQueries()` — the two calls a login/identity boundary makes when it must guarantee that
 * nothing from the previous identity can still be read.
 *
 * Provenance controls: the FIRST fetch returns 'v1'; later fetches return 'v2' (first test) or
 * hang forever (second test). So anything the cache serves after removal is attributable: 'v1'
 * could only be a retained value, 'v2' only a refetch, and the fetch counter makes the same
 * distinction independently of the value. staleTime keeps the mounted observer from refetching on
 * its own.
 *
 * At solid-query 6.0.0-rc.0 the removal sticks: no re-add, no refetch, empty cache. At 6.0.0-rc.1
 * the entry is removed, immediately re-added, and REFETCHED — the old value is not retained
 * (during the refetch the cache holds nothing), but the entry the caller just removed exists
 * again, and the refetch repopulates it.
 */
async function setup(queryFn: () => Promise<string>) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } });
	const key = ['probe'] as const;

	await queryClient.prefetchQuery({ queryKey: key, queryFn });
	expect(queryClient.getQueryData(key)).toBe('v1');

	function Reader() {
		const query = useQuery(() => ({ queryKey: key, queryFn }));
		return <div data-testid="out">{String(query.data)}</div>;
	}
	render(() => (
		<QueryClientProvider client={queryClient}>
			<Reader />
		</QueryClientProvider>
	));
	await new Promise((resolve) => setTimeout(resolve, 30));

	return { queryClient, key };
}

describe('removeQueries() on an actively observed query', () => {
	it('stays removed, without a fresh fetch (later fetches return v2)', async () => {
		let fetches = 0;
		const { queryClient, key } = await setup(async () => {
			fetches++;
			return fetches === 1 ? 'v1' : 'v2';
		});
		// staleTime kept the mount from refetching: everything below starts from ONE fetch, so any
		// 'v1' seen after removal could only be retained, and any 'v2' could only be a refetch.
		expect(fetches).toBe(1);

		const events: string[] = [];
		queryClient.getQueryCache().subscribe((event) => events.push(event.type));

		await queryClient.cancelQueries();
		queryClient.removeQueries();
		await new Promise((resolve) => setTimeout(resolve, 30));

		console.log('  cache events:      ', JSON.stringify(events));
		console.log('  getQueryData:      ', JSON.stringify(queryClient.getQueryData(key)));
		console.log('  cache entry count: ', queryClient.getQueryCache().getAll().length);
		console.log('  fetches:           ', fetches, '(2 = the recreated entry refetched)');
		console.log('  observer DOM text: ', JSON.stringify(screen.getByTestId('out').textContent));

		// `removed` fires at BOTH versions — the difference is what follows it.
		expect(events).toContain('removed');
		// rc.1 fails here: the entry is re-added…
		expect(events.filter((e) => e === 'added')).toHaveLength(0);
		expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
		expect(queryClient.getQueryData(key)).toBeUndefined();
		// …and the re-added entry refetches, repopulating the key that was just removed.
		expect(fetches).toBe(1);
	});

	it('stays removed while a would-be refetch hangs (nothing repopulates the cache)', async () => {
		let fetches = 0;
		const { queryClient, key } = await setup(async () => {
			fetches++;
			if (fetches === 1) return 'v1';
			return new Promise<string>(() => {});
		});
		expect(fetches).toBe(1);

		await queryClient.cancelQueries();
		queryClient.removeQueries();
		await new Promise((resolve) => setTimeout(resolve, 50));

		const entry = queryClient.getQueryCache().getAll()[0];
		console.log('  fetches:           ', fetches);
		console.log('  getQueryData:      ', JSON.stringify(queryClient.getQueryData(key)));
		console.log(
			'  entry state:       ',
			entry
				? JSON.stringify({
						status: entry.state.status,
						fetchStatus: entry.state.fetchStatus,
						data: entry.state.data,
					})
				: 'none',
		);
		console.log('  observer DOM text: ', JSON.stringify(screen.getByTestId('out').textContent));

		// The old value is NOT retained by the cache at either version — with the refetch parked,
		// getQueryData stays undefined even where rc.1 has re-added the entry (it sits 'pending').
		expect(queryClient.getQueryData(key)).toBeUndefined();
		// The DOM still shows 'v1' at BOTH versions: removal has never notified observers. Not a
		// regression — callers that need removal to be user-visible already handle this themselves.
		expect(screen.getByTestId('out').textContent).toBe('v1');
		// rc.1 fails here: the entry exists again, mid-refetch.
		expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
		expect(fetches).toBe(1);
	});
});
