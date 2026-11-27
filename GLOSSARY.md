# Watch History Search

A local watch-history catalog and search domain for recording, enriching, deduplicating, and querying viewed videos across multiple YouTube accounts and ingestion sources.

## Language

**Video**:
A canonical YouTube item identified by its `videoId`, holding shared metadata (title, channel, kind, duration, and description snippet).
_Avoid_: clip, item, entry

**Watch**:
A single timestamped viewing event of a `Video` on an `Account` from a `Watch Source`.
_Avoid_: history row, view, log entry

**Account**:
A YouTube identity (Google login, Brand Account, or the `"blank"` signed-out state) under which a `Watch` occurred, paired with a user-editable label.
_Avoid_: profile, user, channel (reserved for a video's creator)

**Video Kind**:
The classification of a `Video` (`video`, `short`, `live`, or `music`).
_Avoid_: type, category, format

**Watch Source**:
Where a `Watch` originated (`live`, `takeout`, or future `fehistory`).
_Avoid_: origin, provider, feed

**Watch Observation**:
An unmerged sighting of a `Video` being watched, supplied by an ingestion path before deduplication and metadata merging.
_Avoid_: raw event, payload, record

**Backup Snapshot**:
A portable JSON export of all stored `Video`, `Watch`, and `Account` records.
_Avoid_: dump, archive
