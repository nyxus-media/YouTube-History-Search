# Persist history in sharded FireMonkey GM storage over page IndexedDB

- Status: accepted

## Context

We need local persistence in Firefox for tens of thousands of watch records, and page scripts on `youtube.com` must not be able to read or overwrite the saved history. Storing data in YouTube's page-level `IndexedDB` would give us native secondary indexes, but clearing YouTube cookies or site data in Firefox would wipe the entire local library.

## Decision

We persist the history index inside FireMonkey's isolated extension storage (`GM.getValue`, `GM.setValue`, and `GM.deleteValue`, backed by Firefox `storage.local` with `unlimitedStorage`), partitioned into a small metadata index, 16 hex-sharded `Video` buckets, and monthly `Watch` buckets (`YYYY-MM`).

## Considered Options

- **FireMonkey `GM` storage (chosen)**: Survives clearing `youtube.com` site data and stays isolated from page JavaScript, while sharding keeps incremental live-watch writes small.
- **Page-level `IndexedDB` on `youtube.com`**: Offers built-in indexes and cursors, but lives in the same site-data bucket as YouTube cookies and cache and is exposed to page scripts.

## Consequences

- Loading and querying happen in memory inside the userscript after reading shards from extension storage.
- Clearing Firefox site data for YouTube leaves watch history intact; users should still use `Backup Snapshot` exports before uninstalling FireMonkey or resetting their Firefox profile.
