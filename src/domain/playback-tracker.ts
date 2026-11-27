import {
  DESCRIPTION_SNIPPET_MAX_LENGTH,
  type PageVideoContext,
  type WatchObservation
} from "./types.js";

export interface PlaybackState {
  playing: boolean;
  visible: boolean;
  durationSeconds?: number;
}

export interface PlaybackTracker {
  onNavigate(context: PageVideoContext | null, nowMs: number): void;
  onPlaybackStateChange(state: PlaybackState, nowMs: number): void;
  tick(nowMs: number): WatchObservation | null;
}

const DEFAULT_THRESHOLD_MS = 25_000;
const SHORT_FLOOR_SECONDS = 3;
const SHORT_RATIO = 0.8;
const SHORT_CUTOFF_SECONDS = 25;

function sanitizeDuration(durationSeconds: number | undefined): number | undefined {
  if (
    durationSeconds !== undefined &&
    Number.isFinite(durationSeconds) &&
    durationSeconds > 0
  ) {
    return durationSeconds;
  }
  return undefined;
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

function computeThresholdMs(durationSeconds: number | undefined): number {
  const valid = sanitizeDuration(durationSeconds);
  if (valid !== undefined && valid < SHORT_CUTOFF_SECONDS) {
    return Math.max(SHORT_FLOOR_SECONDS, valid * SHORT_RATIO) * 1000;
  }
  return DEFAULT_THRESHOLD_MS;
}

function pickNonEmpty(incoming: string | undefined, existing: string | undefined): string | undefined {
  if (incoming !== undefined && incoming.trim().length > 0) {
    return incoming;
  }
  return existing;
}

function mergeContext(existing: PageVideoContext, incoming: PageVideoContext): PageVideoContext {
  return {
    videoId: existing.videoId,
    accountId: existing.accountId,
    title: pickNonEmpty(incoming.title, existing.title) ?? existing.title,
    channelName: pickNonEmpty(incoming.channelName, existing.channelName),
    channelUrl: pickNonEmpty(incoming.channelUrl, existing.channelUrl),
    kind: incoming.kind ?? existing.kind,
    durationSeconds:
      sanitizeDuration(incoming.durationSeconds) ?? sanitizeDuration(existing.durationSeconds),
    descriptionSnippet: pickNonEmpty(incoming.descriptionSnippet, existing.descriptionSnippet),
    accountLabel: pickNonEmpty(incoming.accountLabel, existing.accountLabel)
  };
}

export function createPlaybackTracker(): PlaybackTracker {
  let context: PageVideoContext | null = null;
  let state: PlaybackState = { playing: false, visible: false };
  let accumulatedMs = 0;
  let activeSegmentStartMs: number | null = null;
  let firstActiveAtMs: number | null = null;
  let emitted = false;

  const isActive = (s: PlaybackState): boolean => s.playing && s.visible;

  const settleActiveTime = (nowMs: number): void => {
    if (activeSegmentStartMs !== null) {
      if (nowMs > activeSegmentStartMs) {
        accumulatedMs += nowMs - activeSegmentStartMs;
      }
      activeSegmentStartMs = nowMs;
    }
  };

  return {
    onNavigate(nextContext, _nowMs) {
      if (
        nextContext !== null &&
        context !== null &&
        nextContext.videoId === context.videoId &&
        nextContext.accountId === context.accountId
      ) {
        context = mergeContext(context, nextContext);
        return;
      }

      context = nextContext ? { ...nextContext } : null;
      state = { playing: false, visible: false };
      accumulatedMs = 0;
      activeSegmentStartMs = null;
      firstActiveAtMs = null;
      emitted = false;
    },

    onPlaybackStateChange(nextState, nowMs) {
      const wasActive = isActive(state);
      const willBeActive = isActive(nextState);

      if (context && !emitted) {
        if (wasActive) {
          settleActiveTime(nowMs);
        }
        if (willBeActive) {
          activeSegmentStartMs = nowMs;
          if (firstActiveAtMs === null) {
            firstActiveAtMs = nowMs;
          }
        } else {
          activeSegmentStartMs = null;
        }
      }

      state = { ...nextState };
    },

    tick(nowMs) {
      if (!context || emitted || firstActiveAtMs === null) {
        return null;
      }
      if (isActive(state) && activeSegmentStartMs !== null) {
        settleActiveTime(nowMs);
      }
      const durationSeconds =
        sanitizeDuration(state.durationSeconds) ?? sanitizeDuration(context.durationSeconds);
      if (accumulatedMs < computeThresholdMs(durationSeconds)) {
        return null;
      }
      emitted = true;
      activeSegmentStartMs = null;
      return {
        videoId: context.videoId,
        title: context.title,
        channelName: context.channelName,
        channelUrl: context.channelUrl,
        kind: context.kind,
        durationSeconds,
        descriptionSnippet: sanitizeSnippet(context.descriptionSnippet),
        accountId: context.accountId,
        accountLabel: context.accountLabel,
        watchedAt: firstActiveAtMs,
        source: "live",
        timestampPrecision: "exact"
      };
    }
  };
}
