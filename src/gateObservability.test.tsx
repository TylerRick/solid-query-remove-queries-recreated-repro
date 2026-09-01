import { createEffect, createMemo, createSignal, flush, onCleanup } from 'solid-js';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/solid-query';
import { render } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';

/**
 * RETAINED CONTROL: can any reactive gate OBSERVE the removal?
 *
 * The consumer shape that motivated this repro is an identity boundary that removes every entry
 * and then gates its UI on a live cache entry existing — the only way to react to removal, since
 * removal does not notify observers. Two gate implementations (a createMemo, and the same
 * expression as a plain tracked effect — proving the memo is not the deciding layer), each
 * measured under two post-removal fetch behaviours (completes with 'v2' / hangs forever). The
 * timeline records every value the gate exposes to a subscribing effect.
 *
 * At 6.0.0-rc.0 every combination closes the gate promptly: the timeline ends with undefined. At
 * 6.0.0-rc.1 the gate NEVER emits a closed state — 'v1' → 'v2' when the refetch completes, 'v1'
 * forever when it hangs, even during the window where getQueryData is undefined.
 */

const settle = async (ms = 40) => {
	await new Promise((resolve) => setTimeout(resolve, ms));
	flush();
};

function gateCase(name: string, laterFetch: () => Promise<string>, useMemoGate: boolean) {
	it(name, async () => {
		const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } });
		const key = ['probe'] as const;
		let fetches = 0;
		const queryFn = async () => {
			fetches++;
			if (fetches === 1) return 'v1';
			return laterFetch();
		};
		await queryClient.prefetchQuery({ queryKey: key, queryFn });

		/** Every value the gate exposes to a subscribing effect, in order. */
		const timeline: (string | undefined)[] = [];

		function Probe() {
			const query = useQuery(() => ({ queryKey: key, queryFn }));
			const [cacheGeneration, setCacheGeneration] = createSignal(0);
			onCleanup(
				queryClient.getQueryCache().subscribe((event) => {
					if (event.type === 'added' || event.type === 'removed') {
						setCacheGeneration((n) => n + 1);
					}
				}),
			);
			const gateCompute = () => {
				const data = query.data;
				if (!data) return undefined;
				cacheGeneration();
				if (queryClient.getQueryData(key) === undefined) return undefined;
				return data;
			};
			if (useMemoGate) {
				const gated = createMemo(gateCompute);
				createEffect(
					() => gated(),
					(value) => {
						timeline.push(value);
					},
				);
			} else {
				createEffect(gateCompute, (value) => {
					timeline.push(value);
				});
			}
			return <div />;
		}

		render(() => (
			<QueryClientProvider client={queryClient}>
				<Probe />
			</QueryClientProvider>
		));
		await settle();

		await queryClient.cancelQueries();
		queryClient.removeQueries();
		await settle(80);

		console.log('  gate timeline:', JSON.stringify(timeline), ' fetches:', fetches);
		// rc.1 fails here: the gate never exposes a closed (undefined) state after the removal.
		expect(timeline[timeline.length - 1]).toBeUndefined();
	});
}

describe('a reactive gate on a live cache entry, against removeQueries()', () => {
	gateCase('memo gate closes when the refetch completes', () => Promise.resolve('v2'), true);
	gateCase('memo gate closes when the refetch hangs', () => new Promise<string>(() => {}), true);
	gateCase(
		'plain-effect gate closes when the refetch completes',
		() => Promise.resolve('v2'),
		false,
	);
	gateCase(
		'plain-effect gate closes when the refetch hangs',
		() => new Promise<string>(() => {}),
		false,
	);
});
