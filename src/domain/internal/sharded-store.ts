import type { Account, StorageAdapter, Video, Watch } from "../types.js";

const META_KEY = "yths:meta";
const VIDEO_BUCKET_PREFIX = "yths:videos:";
const WATCH_MONTH_PREFIX = "yths:watches:";
const HEX_BUCKETS = [
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "a",
  "b",
  "c",
  "d",
  "e",
  "f"
] as const;

interface StoredMeta {
  schemaVersion: 1;
  accounts: Account[];
  watchMonths: string[];
}

export interface DirtyTracker {
  metaDirty: boolean;
  videoBuckets: Set<string>;
  watchMonths: Set<string>;
}

export interface LoadedLibraryState {
  accounts: Map<string, Account>;
  videos: Map<string, Video>;
  watches: Watch[];
  knownMonths: Set<string>;
}

export function getVideoBucket(videoId: string): string {
  let hash = 2166136261;
  for (let i = 0; i < videoId.length; i += 1) {
    hash ^= videoId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash & 0xf).toString(16);
}

export function getUtcMonth(watchedAtMs: number): string {
  const date = new Date(watchedAtMs);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

async function readShardBatch(
  storage: StorageAdapter,
  keys: string[]
): Promise<Record<string, unknown>> {
  if (keys.length === 0) {
    return {};
  }
  if (storage.getMany) {
    return await storage.getMany(keys);
  }
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const val = await storage.get<unknown>(key);
    if (val !== undefined) {
      result[key] = val;
    }
  }
  return result;
}

export async function loadShardedState(
  storage: StorageAdapter
): Promise<LoadedLibraryState> {
  const accounts = new Map<string, Account>();
  const videos = new Map<string, Video>();
  const watches: Watch[] = [];
  const knownMonths = new Set<string>();

  const meta = await storage.get<StoredMeta>(META_KEY);
  if (meta) {
    for (const acc of meta.accounts) {
      accounts.set(acc.accountId, { ...acc });
    }
    for (const m of meta.watchMonths) {
      knownMonths.add(m);
    }
  }

  const videoKeys = HEX_BUCKETS.map((bucket) => `${VIDEO_BUCKET_PREFIX}${bucket}`);
  const watchKeys = Array.from(knownMonths).map((month) => `${WATCH_MONTH_PREFIX}${month}`);
  const loadedShards = await readShardBatch(storage, [...videoKeys, ...watchKeys]);

  for (const key of videoKeys) {
    const bucketVideos = loadedShards[key] as Video[] | undefined;
    if (!Array.isArray(bucketVideos)) {
      continue;
    }
    for (const video of bucketVideos) {
      videos.set(video.videoId, { ...video });
    }
  }

  for (const key of watchKeys) {
    const monthWatches = loadedShards[key] as Watch[] | undefined;
    if (!Array.isArray(monthWatches)) {
      continue;
    }
    for (const watch of monthWatches) {
      watches.push({ ...watch });
    }
  }

  return { accounts, videos, watches, knownMonths };
}

export async function flushDirtyShards(
  storage: StorageAdapter,
  state: LoadedLibraryState,
  dirty: DirtyTracker
): Promise<void> {
  let metaDirty = dirty.metaDirty;
  const toSet: Record<string, unknown> = {};
  const toDelete: string[] = [];

  if (dirty.watchMonths.size > 0) {
    const byMonth = new Map<string, Watch[]>();
    for (const month of dirty.watchMonths) {
      byMonth.set(month, []);
    }
    for (const watch of state.watches) {
      const month = getUtcMonth(watch.watchedAt);
      const bucket = byMonth.get(month);
      if (bucket) {
        bucket.push(watch);
      }
    }

    for (const [month, monthWatches] of byMonth) {
      const key = `${WATCH_MONTH_PREFIX}${month}`;
      if (monthWatches.length === 0) {
        toDelete.push(key);
        if (state.knownMonths.delete(month)) {
          metaDirty = true;
        }
      } else {
        toSet[key] = monthWatches;
        if (!state.knownMonths.has(month)) {
          state.knownMonths.add(month);
          metaDirty = true;
        }
      }
    }
  }

  if (dirty.videoBuckets.size > 0) {
    const byBucket = new Map<string, Video[]>();
    for (const bucket of dirty.videoBuckets) {
      byBucket.set(bucket, []);
    }
    for (const video of state.videos.values()) {
      const bucket = getVideoBucket(video.videoId);
      const list = byBucket.get(bucket);
      if (list) {
        list.push(video);
      }
    }
    for (const [bucket, bucketVideos] of byBucket) {
      toSet[`${VIDEO_BUCKET_PREFIX}${bucket}`] = bucketVideos;
    }
  }

  if (metaDirty) {
    const meta: StoredMeta = {
      schemaVersion: 1,
      accounts: Array.from(state.accounts.values()),
      watchMonths: Array.from(state.knownMonths).sort()
    };
    toSet[META_KEY] = meta;
  }

  if (Object.keys(toSet).length > 0) {
    if (storage.setMany) {
      await storage.setMany(toSet);
    } else {
      for (const [key, value] of Object.entries(toSet)) {
        await storage.set(key, value);
      }
    }
  }

  for (const key of toDelete) {
    await storage.delete(key);
  }
}
