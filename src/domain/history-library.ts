import {
  flushDirtyShards,
  getUtcMonth,
  getVideoBucket,
  loadShardedState,
  type DirtyTracker,
  type LoadedLibraryState
} from "./internal/sharded-store.js";
import { parseTakeoutWatchHistory } from "./internal/takeout-parser.js";
import { compileSearchQuery } from "./internal/query-engine.js";
import {
  BLANK_ACCOUNT_ID,
  DEDUP_WINDOW_MS,
  DESCRIPTION_SNIPPET_MAX_LENGTH,
  type Account,
  type BackupImportSummary,
  type BackupSnapshot,
  type CollapsedSearchRow,
  type FlatSearchRow,
  type ImportSummary,
  type SearchOptions,
  type SearchResult,
  type SearchResultItem,
  type SortMode,
  type StorageAdapter,
  type Video,
  type Watch,
  type WatchObservation
} from "./types.js";

export interface HistoryLibrary {
  load(): Promise<void>;
  recordWatches(
    observations: WatchObservation[]
  ): Promise<{ imported: number; deduplicated: number }>;
  importTakeout(
    rawJson: string,
    options: { accountId: string; accountLabel?: string }
  ): Promise<ImportSummary>;
  search(query: string, options?: SearchOptions): SearchResult;
  listAccounts(): Account[];
  setAccountLabel(accountId: string, label: string): Promise<Account>;
  exportBackup(): BackupSnapshot;
  importBackup(rawJson: string): Promise<BackupImportSummary>;
}

function normalizeAccountId(accountId: string): string {
  const trimmed = accountId.trim();
  return trimmed.length > 0 ? trimmed : BLANK_ACCOUNT_ID;
}

function sanitizeSnippet(snippet: string | undefined): string | undefined {
  if (snippet === undefined) {
    return undefined;
  }
  const trimmed = snippet.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed.slice(0, DESCRIPTION_SNIPPET_MAX_LENGTH);
}

function sanitizeDuration(durationSeconds: number | undefined): number | undefined {
  if (durationSeconds !== undefined && Number.isFinite(durationSeconds) && durationSeconds > 0) {
    return durationSeconds;
  }
  return undefined;
}

function mergeVideoKind(existing: Video["kind"], incoming: Video["kind"] | undefined): Video["kind"] {
  if (!incoming || incoming === "video") {
    return existing;
  }
  if (existing === "video") {
    return incoming;
  }
  return existing;
}

function videosEqual(a: Video, b: Video): boolean {
  return (
    a.videoId === b.videoId &&
    a.title === b.title &&
    a.channelName === b.channelName &&
    a.channelUrl === b.channelUrl &&
    a.kind === b.kind &&
    a.durationSeconds === b.durationSeconds &&
    a.descriptionSnippet === b.descriptionSnippet
  );
}

function mergeVideo(existing: Video | undefined, incoming: WatchObservation): Video {
  const incomingTitle = incoming.title.trim();
  const incomingChannelName = (incoming.channelName ?? "").trim();
  const incomingChannelUrl = (incoming.channelUrl ?? "").trim();
  const incomingDuration = sanitizeDuration(incoming.durationSeconds);
  const incomingSnippet = sanitizeSnippet(incoming.descriptionSnippet);

  if (!existing) {
    const created: Video = {
      videoId: incoming.videoId,
      title: incomingTitle,
      channelName: incomingChannelName,
      channelUrl: incomingChannelUrl,
      kind: incoming.kind ?? "video"
    };
    if (incomingDuration !== undefined) {
      created.durationSeconds = incomingDuration;
    }
    if (incomingSnippet !== undefined) {
      created.descriptionSnippet = incomingSnippet;
    }
    return created;
  }

  const merged: Video = {
    videoId: existing.videoId,
    title: existing.title.trim().length > 0 ? existing.title : incomingTitle,
    channelName:
      existing.channelName.trim().length > 0 ? existing.channelName : incomingChannelName,
    channelUrl:
      existing.channelUrl.trim().length > 0 ? existing.channelUrl : incomingChannelUrl,
    kind: mergeVideoKind(existing.kind, incoming.kind)
  };

  const durationSeconds = existing.durationSeconds ?? incomingDuration;
  if (durationSeconds !== undefined) {
    merged.durationSeconds = durationSeconds;
  }

  let descriptionSnippet = existing.descriptionSnippet;
  if (
    incomingSnippet !== undefined &&
    (descriptionSnippet === undefined || incomingSnippet.length > descriptionSnippet.length)
  ) {
    descriptionSnippet = incomingSnippet;
  }
  if (descriptionSnippet !== undefined) {
    merged.descriptionSnippet = descriptionSnippet;
  }

  return merged;
}

function registerAccount(
  state: LoadedLibraryState,
  rawAccountId: string,
  incomingLabel: string | undefined,
  dirty: DirtyTracker,
  upgradeDefaultLabel = false
): { accountId: string; changed: boolean } {
  const accountId = normalizeAccountId(rawAccountId);
  const cleanLabel =
    incomingLabel && incomingLabel.trim().length > 0 ? incomingLabel.trim() : accountId;
  const existing = state.accounts.get(accountId);

  if (!existing) {
    state.accounts.set(accountId, { accountId, label: cleanLabel });
    dirty.metaDirty = true;
    return { accountId, changed: true };
  }

  if (upgradeDefaultLabel && existing.label === existing.accountId && cleanLabel !== accountId) {
    state.accounts.set(accountId, { accountId, label: cleanLabel });
    dirty.metaDirty = true;
    return { accountId, changed: true };
  }

  return { accountId, changed: false };
}

function mergeVideoIntoState(
  state: LoadedLibraryState,
  obs: WatchObservation,
  dirty: DirtyTracker
): void {
  const existingVideo = state.videos.get(obs.videoId);
  const merged = mergeVideo(existingVideo, obs);
  if (!existingVideo || !videosEqual(existingVideo, merged)) {
    state.videos.set(obs.videoId, merged);
    dirty.videoBuckets.add(getVideoBucket(obs.videoId));
  }
}

function upsertWatchIntoState(
  state: LoadedLibraryState,
  incoming: Watch,
  dirty: DirtyTracker
): "imported" | "deduplicated" {
  const existingMatch = state.watches.find(
    (w) =>
      w.accountId === incoming.accountId &&
      w.videoId === incoming.videoId &&
      Math.abs(w.watchedAt - incoming.watchedAt) <= DEDUP_WINDOW_MS
  );

  if (existingMatch) {
    const oldMonth = getUtcMonth(existingMatch.watchedAt);
    let updated = false;
    if (
      existingMatch.timestampPrecision === "approximate" &&
      incoming.timestampPrecision === "exact"
    ) {
      existingMatch.watchedAt = incoming.watchedAt;
      existingMatch.timestampPrecision = "exact";
      existingMatch.source = incoming.source;
      updated = true;
    } else if (
      existingMatch.timestampPrecision === incoming.timestampPrecision &&
      incoming.watchedAt < existingMatch.watchedAt
    ) {
      existingMatch.watchedAt = incoming.watchedAt;
      existingMatch.source = incoming.source;
      updated = true;
    }
    if (updated) {
      dirty.watchMonths.add(oldMonth);
      dirty.watchMonths.add(getUtcMonth(existingMatch.watchedAt));
    }
    return "deduplicated";
  }

  state.watches.push({ ...incoming });
  dirty.watchMonths.add(getUtcMonth(incoming.watchedAt));
  return "imported";
}

export function createHistoryLibrary(storage: StorageAdapter): HistoryLibrary {
  let state: LoadedLibraryState = {
    accounts: new Map<string, Account>(),
    videos: new Map<string, Video>(),
    watches: [],
    knownMonths: new Set<string>()
  };
  let writeQueue: Promise<unknown> = Promise.resolve();

  const withWriteLock = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = () => storage.withExclusiveLock ? storage.withExclusiveLock(fn) : fn();
    const next = writeQueue.then(run, run);
    writeQueue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  };

  const reloadFreshState = async (): Promise<void> => {
    state = await loadShardedState(storage);
  };

  const createDirtyTracker = (): DirtyTracker => ({
    metaDirty: false,
    videoBuckets: new Set<string>(),
    watchMonths: new Set<string>()
  });

  const library: HistoryLibrary = {
    async load() {
      return withWriteLock(async () => {
        await reloadFreshState();
      });
    },

    async recordWatches(observations) {
      return withWriteLock(async () => {
        await reloadFreshState();
        const dirty = createDirtyTracker();
        let imported = 0;
        let deduplicated = 0;

        for (const obs of observations) {
          const { accountId } = registerAccount(state, obs.accountId, obs.accountLabel, dirty);
          mergeVideoIntoState(state, obs, dirty);
          const outcome = upsertWatchIntoState(
            state,
            {
              videoId: obs.videoId,
              accountId,
              watchedAt: obs.watchedAt,
              source: obs.source,
              timestampPrecision: obs.timestampPrecision
            },
            dirty
          );
          if (outcome === "imported") {
            imported += 1;
          } else {
            deduplicated += 1;
          }
        }

        await flushDirtyShards(storage, state, dirty);
        return { imported, deduplicated };
      });
    },

    async importTakeout(rawJson, options) {
      const accountId = normalizeAccountId(options.accountId);
      const parsed = parseTakeoutWatchHistory(rawJson, accountId, options.accountLabel);
      const { imported, deduplicated } = await library.recordWatches(parsed.observations);
      return {
        ...parsed.counts,
        imported,
        deduplicated
      };
    },

    search(query, options) {
      const compiled = compileSearchQuery(query, options);
      if (compiled.error) {
        return {
          totalMatches: 0,
          items: [],
          queryError: compiled.error
        };
      }

      const defaultSort: SortMode =
        !options?.strict && compiled.hasTextClauses ? "relevance" : "newest";
      const sort = options?.sort ?? defaultSort;
      const offset = options?.offset ?? 0;
      const limit = options?.limit;
      const matched: Array<{ row: FlatSearchRow; score: number }> = [];

      for (const watch of state.watches) {
        const video = state.videos.get(watch.videoId);
        if (!video) {
          continue;
        }
        const accountLabel = state.accounts.get(watch.accountId)?.label ?? watch.accountId;
        const evalResult = compiled.evaluate(video, watch, accountLabel);
        if (!evalResult.matched) {
          continue;
        }
        matched.push({
          row: {
            rowType: "watch",
            video: { ...video },
            watch: { ...watch },
            accountLabel
          },
          score: evalResult.score
        });
      }

      let allItems: SearchResultItem[];

      if (sort === "most-watched") {
        const groups = new Map<string, CollapsedSearchRow>();
        for (const { row } of matched) {
          let group = groups.get(row.video.videoId);
          if (!group) {
            group = {
              rowType: "collapsed",
              video: row.video,
              watchCount: 0,
              latestWatchedAt: row.watch.watchedAt,
              watches: []
            };
            groups.set(row.video.videoId, group);
          }
          group.watchCount += 1;
          if (row.watch.watchedAt > group.latestWatchedAt) {
            group.latestWatchedAt = row.watch.watchedAt;
          }
          group.watches.push({
            watch: row.watch,
            accountLabel: row.accountLabel
          });
        }

        const collapsed = Array.from(groups.values());
        for (const group of collapsed) {
          group.watches.sort((a, b) => b.watch.watchedAt - a.watch.watchedAt);
        }
        collapsed.sort(
          (a, b) =>
            b.watchCount - a.watchCount || b.latestWatchedAt - a.latestWatchedAt
        );
        allItems = collapsed;
      } else {
        matched.sort((a, b) => {
          if (sort === "relevance") {
            return b.score - a.score || b.row.watch.watchedAt - a.row.watch.watchedAt;
          }
          return sort === "oldest"
            ? a.row.watch.watchedAt - b.row.watch.watchedAt
            : b.row.watch.watchedAt - a.row.watch.watchedAt;
        });
        allItems = matched.map((entry) => entry.row);
      }

      const sliced =
        limit !== undefined
          ? allItems.slice(offset, offset + limit)
          : allItems.slice(offset);

      return {
        totalMatches: allItems.length,
        items: sliced
      };
    },

    listAccounts() {
      return Array.from(state.accounts.values()).map((a) => ({ ...a }));
    },

    async setAccountLabel(accountId, label) {
      return withWriteLock(async () => {
        await reloadFreshState();
        const normalized = normalizeAccountId(accountId);
        const next: Account = { accountId: normalized, label: label.trim() || normalized };
        state.accounts.set(normalized, next);
        const dirty = createDirtyTracker();
        dirty.metaDirty = true;
        await flushDirtyShards(storage, state, dirty);
        return { ...next };
      });
    },

    exportBackup() {
      return {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        accounts: library.listAccounts(),
        videos: Array.from(state.videos.values()).map((v) => ({ ...v })),
        watches: state.watches.map((w) => ({ ...w }))
      };
    },

    async importBackup(rawJson) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawJson);
      } catch {
        throw new Error("Invalid Backup JSON: unable to parse JSON");
      }

      if (!parsed || typeof parsed !== "object") {
        throw new Error("Invalid Backup JSON: expected an object");
      }

      const candidate = parsed as Partial<BackupSnapshot>;
      if (
        candidate.schemaVersion !== 1 ||
        !Array.isArray(candidate.accounts) ||
        !Array.isArray(candidate.videos) ||
        !Array.isArray(candidate.watches)
      ) {
        throw new Error("Invalid Backup JSON: unsupported schemaVersion or missing collections");
      }

      return withWriteLock(async () => {
        await reloadFreshState();
        const dirty = createDirtyTracker();
        let accountsMerged = 0;
        let videosMerged = 0;
        let totalWatches = 0;
        let importedWatches = 0;
        let deduplicatedWatches = 0;

        for (const acc of candidate.accounts ?? []) {
          if (!acc || typeof acc !== "object" || typeof acc.accountId !== "string") {
            continue;
          }
          const label = typeof acc.label === "string" ? acc.label : undefined;
          const { changed } = registerAccount(state, acc.accountId, label, dirty, true);
          if (changed) {
            accountsMerged += 1;
          }
        }

        for (const video of candidate.videos ?? []) {
          if (!video || typeof video !== "object" || typeof video.videoId !== "string") {
            continue;
          }
          const videoId = video.videoId.trim();
          if (!videoId) {
            continue;
          }
          mergeVideoIntoState(
            state,
            {
              videoId,
              title: typeof video.title === "string" ? video.title : "",
              channelName: typeof video.channelName === "string" ? video.channelName : "",
              channelUrl: typeof video.channelUrl === "string" ? video.channelUrl : "",
              kind:
                video.kind === "short" ||
                video.kind === "live" ||
                video.kind === "music" ||
                video.kind === "video"
                  ? video.kind
                  : "video",
              durationSeconds:
                typeof video.durationSeconds === "number" ? video.durationSeconds : undefined,
              descriptionSnippet:
                typeof video.descriptionSnippet === "string"
                  ? video.descriptionSnippet
                  : undefined,
              accountId: BLANK_ACCOUNT_ID,
              watchedAt: 0,
              source: "takeout",
              timestampPrecision: "exact"
            },
            dirty
          );
          videosMerged += 1;
        }

        for (const watch of candidate.watches ?? []) {
          if (
            !watch ||
            typeof watch !== "object" ||
            typeof watch.videoId !== "string" ||
            typeof watch.watchedAt !== "number" ||
            !Number.isFinite(watch.watchedAt)
          ) {
            continue;
          }
          totalWatches += 1;
          const rawAccId =
            typeof watch.accountId === "string" ? watch.accountId : BLANK_ACCOUNT_ID;
          const { accountId, changed } = registerAccount(state, rawAccId, undefined, dirty);
          if (changed) {
            accountsMerged += 1;
          }

          const source =
            watch.source === "live" ||
            watch.source === "takeout" ||
            watch.source === "fehistory"
              ? watch.source
              : "takeout";
          const precision =
            watch.timestampPrecision === "approximate" ? "approximate" : "exact";

          const outcome = upsertWatchIntoState(
            state,
            {
              videoId: watch.videoId,
              accountId,
              watchedAt: watch.watchedAt,
              source,
              timestampPrecision: precision
            },
            dirty
          );
          if (outcome === "imported") {
            importedWatches += 1;
          } else {
            deduplicatedWatches += 1;
          }
        }

        await flushDirtyShards(storage, state, dirty);
        return {
          totalWatches,
          importedWatches,
          deduplicatedWatches,
          videosMerged,
          accountsMerged
        };
      });
    }
  };

  return library;
}
