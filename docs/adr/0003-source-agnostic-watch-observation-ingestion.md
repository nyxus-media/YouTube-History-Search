# Use source-agnostic Watch Observation ingestion with timestamp precision

- Status: accepted

## Context

Version 1 ingests watches from live Firefox playback (`live`) and Google Takeout exports (`takeout`), and version 2 will add incremental sync from YouTube's internal `FEhistory` endpoint (`fehistory`). Cross-source deduplication within a 30-minute per-account window must reconcile exact timestamps against future approximate timestamps (such as relative day labels from `FEhistory`) without rewriting storage or deduplication logic later.

## Decision

Every ingestion path emits `WatchObservation` records carrying `source` (`live` | `takeout` | `fehistory`) and `timestampPrecision` (`exact` | `approximate`) into a single `recordWatches` pipeline from v1.

## Considered Options

- **Source-agnostic `WatchObservation` with explicit `timestampPrecision` (chosen)**: Lets future `FEhistory` sync plug directly into `recordWatches` with zero schema migration and ensures exact timestamps always replace approximate ones within the 30-minute per-account window.
- **Separate per-source storage or v1-only live/Takeout schema**: Would require a breaking data migration and custom cross-source merge passes when adding Approach B later.

## Consequences

- All v1 storage shards and `Backup Snapshot` exports carry `source` and `timestampPrecision` on every `Watch`.
- Adding `FEhistory` sync later requires only a new fetcher that outputs `WatchObservation[]`.
