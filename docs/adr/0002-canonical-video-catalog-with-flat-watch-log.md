# Store canonical Video metadata separately from flat Watch rows

- Status: accepted

## Context

Google Takeout exports provide `videoId`, title, channel name/URL, and timestamp, while live Firefox visits also capture `Video Kind` (`short`, `live`, `video`), duration, and a 500-character description snippet. Search results must display flat individual `Watch` rows in chronological modes so rewatches at different times stay visible, while avoiding duplicating large description snippets in storage.

## Decision

We normalize canonical `Video` metadata once per `videoId` (merged with a "richer wins" policy) and store flat `Watch` rows referencing `videoId`, joining them at query time.

## Considered Options

- **Normalized `Video` catalog + flat `Watch` log (chosen)**: Enriches historical Takeout watches automatically whenever the same video is watched live, avoids repeating description text per rewatch, and supports both flat chronological rows and collapsed "most watched" summaries.
- **Denormalized flat rows**: Duplicates descriptions and titles on every rewatch and prevents older sparse watches from benefiting when richer metadata arrives later.
- **Single `Video` row with only `lastWatchedAt`**: Loses earlier rewatch timestamps needed for chronological history search and accurate date-range filtering.

## Consequences

- Reads join each `Watch` with its canonical `Video` record by `videoId`.
- The `"most-watched"` sort mode groups matching `Watch` rows by `videoId` into one summary row with expandable timestamps, while `"newest"` and `"oldest"` return flat `Watch` rows.
