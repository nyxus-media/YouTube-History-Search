export const BLANK_ACCOUNT_ID = "blank";
export const DESCRIPTION_SNIPPET_MAX_LENGTH = 500;
export const DEDUP_WINDOW_MS = 30 * 60 * 1000;

export type VideoKind = "video" | "short" | "live" | "music";
export type WatchSource = "live" | "takeout" | "fehistory";
export type TimestampPrecision = "exact" | "approximate";
export type SortMode = "relevance" | "newest" | "oldest" | "most-watched";

export interface Account {
  accountId: string;
  label: string;
}

export interface Video {
  videoId: string;
  title: string;
  channelName: string;
  channelUrl: string;
  kind: VideoKind;
  durationSeconds?: number;
  descriptionSnippet?: string;
}

export interface Watch {
  videoId: string;
  accountId: string;
  watchedAt: number;
  source: WatchSource;
  timestampPrecision: TimestampPrecision;
}

export interface WatchObservation {
  videoId: string;
  title: string;
  channelName?: string;
  channelUrl?: string;
  kind?: VideoKind;
  durationSeconds?: number;
  descriptionSnippet?: string;
  accountId: string;
  accountLabel?: string;
  watchedAt: number;
  source: WatchSource;
  timestampPrecision: TimestampPrecision;
}

export interface PageVideoContext {
  videoId: string;
  title: string;
  channelName?: string;
  channelUrl?: string;
  kind?: VideoKind;
  durationSeconds?: number;
  descriptionSnippet?: string;
  accountId: string;
  accountLabel?: string;
}

export interface SearchOptions {
  sort?: SortMode;
  regex?: boolean;
  strict?: boolean;
  accountId?: string;
  kind?: VideoKind;
  afterDate?: string;
  beforeDate?: string;
  limit?: number;
  offset?: number;
}

export interface FlatSearchRow {
  rowType: "watch";
  video: Video;
  watch: Watch;
  accountLabel: string;
}

export interface CollapsedWatchEntry {
  watch: Watch;
  accountLabel: string;
}

export interface CollapsedSearchRow {
  rowType: "collapsed";
  video: Video;
  watchCount: number;
  latestWatchedAt: number;
  watches: CollapsedWatchEntry[];
}

export type SearchResultItem = FlatSearchRow | CollapsedSearchRow;

export interface SearchResult {
  totalMatches: number;
  items: SearchResultItem[];
  queryError?: string;
}

export interface ImportSummary {
  totalEntries: number;
  imported: number;
  deduplicated: number;
  skippedAds: number;
  skippedRemoved: number;
  skippedInvalid: number;
}

export interface BackupImportSummary {
  totalWatches: number;
  importedWatches: number;
  deduplicatedWatches: number;
  videosMerged: number;
  accountsMerged: number;
}

export interface BackupSnapshot {
  schemaVersion: 1;
  exportedAt: string;
  accounts: Account[];
  videos: Video[];
  watches: Watch[];
}

export interface StorageAdapter {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  getMany?(keys: string[]): Promise<Record<string, unknown>>;
  setMany?(entries: Record<string, unknown>): Promise<void>;
}
