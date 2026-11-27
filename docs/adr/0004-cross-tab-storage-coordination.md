# Coordinate shard transactions and notify other tabs after commit

- Status: accepted

## Context

Each tab has its own HistoryLibrary and promise queue. Reloading before writes prevents stale sequential updates but does not prevent concurrent read/modify/write operations from overwriting the same monthly watch shard or metadata. An open search modal also reads only its local in-memory state.

## Decision

The production storage adapter exposes an exclusive Web Lock. HistoryLibrary acquires it around its existing queue operations, covering the complete reload, mutation, and shard flush. Reads use the same lock so refresh cannot observe a partially written transaction. Live watches, Takeout imports, backup merges, and account edits all use this path. Adapters without shared storage may omit the lock hook.

After all changed shards have been persisted, the adapter writes a unique revision token to GM storage. GM.addValueChangeListener observes remote revision changes, queues a reload, and refreshes open search results. Bursts coalesce; an event during a reload triggers another reload. Read-only refreshes never publish a revision. Tool inputs are not rebuilt by background refresh.

## Constraints

Web Locks coordinate only the same origin and browser storage partition. The current userscript matches only https://www.youtube.com/*, but Firefox containers and private windows may use different lock partitions while sharing extension storage. Concurrent writes across those boundaries are not covered. All open tabs must be reloaded after upgrading, because older script instances do not acquire the lock.

This preserves the existing data format and keeps history in extension storage. Locks contain no history data. There is no unsafe fallback when Web Locks are unavailable. This is mutual exclusion, not crash-atomic storage: a tab/process failure midway through a multi-shard write may still leave partial data.

## References

- [Web Locks](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)
- [FireMonkey storage listeners](https://erosman.github.io/firemonkey/src/content/help.html#GM.addValueChangeListener)

## Firefox userscript callback boundary

FireMonkey's MV2 userScript sandbox rejects a regular lock callback returning a Promise with Permission denied to access property "then". Merely constructing window.Promise, using unsafeWindow.Promise, or cloning a thenable does not fix the callback boundary. A real Firefox MV2 reproduction confirmed these failures.

Export the callback itself with exportFunction(acquired, unsafeWindow, {allowCrossOriginArguments: true}) and return a window.Promise from that callback. The browser supplies a cross-compartment Lock argument, which the callback ignores. Only an undefined completion signal leaves the closure; task results, errors, and history stay private. This combination passed the strict-CSP Firefox reproduction and the actual storage adapter integration fixture. The API is used programmatically; no browser or user permission change is needed.
