# solid-query 6.0.0-rc.1: `removeQueries()` on an actively observed query is immediately re-created and refetched

Reproduction for a bug report against `@tanstack/solid-query` 6.0.0-rc.1.

Calling `queryClient.removeQueries()` while a `useQuery` observer is mounted removes the entry and
then immediately brings it back: the cache emits `removed` followed by `added`, the observer is
torn down and re-attached, and the recreated entry starts a fresh fetch of the key that was just
removed. At 6.0.0-rc.0 the removal sticks.

Two tests, both passing at rc.0 and failing at rc.1, with provenance controls so every
post-removal value is attributable: the first fetch returns `'v1'`, later fetches return `'v2'`
(first test) or hang forever (second test), a fetch counter backs both up, and `staleTime` rules
out an ordinary mount refetch.

## Run it

```sh
pnpm install
./node_modules/.bin/vitest run --disableConsoleIntercept
```

`--disableConsoleIntercept` surfaces the diagnostic `console.log` lines on a PASS as well.

For the version control, set `@tanstack/solid-query` to `6.0.0-rc.0` in `package.json` (leaving the
`@tanstack/query-core` override at 5.101.4), `pnpm install`, and run again: both tests pass.

## The evidence

| field, after `removeQueries()`  | 6.0.0-rc.0       | 6.0.0-rc.1                                                                      |
| ------------------------------- | ---------------- | ------------------------------------------------------------------------------- |
| cache events                    | …, **`removed`** | …, **`removed`**, **`added`**, `observerRemoved`, `observerAdded`, `updated`, … |
| cache entry count               | 0                | 1                                                                                |
| fetch count (1 at removal time) | 1                | **2** — the recreated entry refetched                                            |
| `getQueryData`                  | `undefined`      | `'v2'` once the refetch lands; `undefined` while it is in flight                 |
| observer DOM text               | `'v1'`           | `'v1'` until the refetch lands, then `'v2'`                                      |

**`removed` fires at BOTH versions.** The difference is what follows it: at rc.1 an `added` event
re-creates the entry, the observer is torn down and re-attached, and the recreated entry
immediately refetches, repopulating the key that was just removed.

Two things the provenance controls rule in and out:

- **The old value is NOT retained.** With the refetch parked on a never-resolving promise, the
  re-added entry sits `'pending'`/`'fetching'` and `getQueryData` stays `undefined` — nothing
  serves `'v1'` from the cache at either version.
- **The DOM showing `'v1'` after removal is NOT part of the regression.** Removal has never
  notified observers — rc.0 shows the same `'v1'`.

## Versions

`@tanstack/query-core` is pinned at 5.101.4 in every cell (rc.1's own exact dependency, via a
direct dependency plus a `pnpm.overrides` entry), so the query-core bump that normally rides along
with rc.1 is held constant and solid-query is the only variable.

Full environment: `solid-js` / `@solidjs/web` 2.0.0-rc.4, `@solidjs/testing-library` 1.0.0-beta.2,
`vite-plugin-solid` 3.0.0-next.27, vitest 3, jsdom — client-side only, no SSR, no router.
