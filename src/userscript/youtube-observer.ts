import type { HistoryLibrary } from "../domain/history-library.js";
import type { PlaybackTracker } from "../domain/playback-tracker.js";
import {
  BLANK_ACCOUNT_ID,
  DESCRIPTION_SNIPPET_MAX_LENGTH,
  type Account,
  type PageVideoContext,
  type VideoKind
} from "../domain/types.js";

interface RouteTarget {
  videoId: string;
  kind: VideoKind;
}

interface PlayerDetailsSnapshot {
  videoId?: string;
  title?: string;
  author?: string;
  channelId?: string;
  lengthSeconds?: number;
  isLiveContent?: boolean;
  shortDescription?: string;
}

export interface YouTubeObserverHandle {
  getCurrentAccount(): Account;
  stop(): void;
}

function getPageWindow(): Record<string, unknown> | null {
  try {
    if (typeof unsafeWindow !== "undefined" && unsafeWindow) {
      return unsafeWindow as unknown as Record<string, unknown>;
    }
  } catch {
    // Fall back to sandbox window if unsafeWindow is unavailable
  }
  return typeof window !== "undefined" ? (window as unknown as Record<string, unknown>) : null;
}

function readYtCfgAccount(): Account {
  const win = getPageWindow();
  if (!win) {
    return { accountId: BLANK_ACCOUNT_ID, label: BLANK_ACCOUNT_ID };
  }

  try {
    const ytcfg = win["ytcfg"] as { get?: (key: string) => unknown } | undefined;
    if (!ytcfg || typeof ytcfg.get !== "function") {
      return { accountId: BLANK_ACCOUNT_ID, label: BLANK_ACCOUNT_ID };
    }
    const loggedIn = Boolean(ytcfg.get("LOGGED_IN"));
    if (!loggedIn) {
      return { accountId: BLANK_ACCOUNT_ID, label: BLANK_ACCOUNT_ID };
    }
    const rawSyncId = ytcfg.get("DATASYNC_ID");
    const accountId = typeof rawSyncId === "string" ? rawSyncId.trim() : "";
    if (!accountId) {
      return { accountId: BLANK_ACCOUNT_ID, label: BLANK_ACCOUNT_ID };
    }
    return { accountId, label: accountId };
  } catch {
    return { accountId: BLANK_ACCOUNT_ID, label: BLANK_ACCOUNT_ID };
  }
}

function readPlayerDetails(expectedVideoId: string): PlayerDetailsSnapshot | null {
  const win = getPageWindow();
  if (!win) {
    return null;
  }

  try {
    const playerResp = win["ytInitialPlayerResponse"] as
      | { videoDetails?: Record<string, unknown> }
      | undefined;
    const details = playerResp?.videoDetails;
    if (!details || typeof details !== "object") {
      return null;
    }
    const videoId = typeof details["videoId"] === "string" ? details["videoId"].trim() : "";
    if (videoId !== expectedVideoId) {
      return null;
    }
    const rawLen = details["lengthSeconds"];
    const parsedLen =
      typeof rawLen === "number"
        ? rawLen
        : typeof rawLen === "string"
          ? Number(rawLen)
          : undefined;
    return {
      videoId,
      title: typeof details["title"] === "string" ? details["title"].trim() : undefined,
      author: typeof details["author"] === "string" ? details["author"].trim() : undefined,
      channelId:
        typeof details["channelId"] === "string" ? details["channelId"].trim() : undefined,
      lengthSeconds:
        parsedLen !== undefined && Number.isFinite(parsedLen) && parsedLen > 0
          ? parsedLen
          : undefined,
      isLiveContent: Boolean(details["isLiveContent"]),
      shortDescription:
        typeof details["shortDescription"] === "string"
          ? details["shortDescription"].trim().slice(0, DESCRIPTION_SNIPPET_MAX_LENGTH)
          : undefined
    };
  } catch {
    return null;
  }
}

function parseRouteTarget(): RouteTarget | null {
  const path = window.location.pathname;
  if (path === "/watch") {
    const v = new URLSearchParams(window.location.search).get("v")?.trim();
    return v ? { videoId: v, kind: "video" } : null;
  }
  const segments = path.split("/").filter(Boolean);
  if (segments[0] === "shorts" && segments[1]) {
    return { videoId: segments[1], kind: "short" };
  }
  if (segments[0] === "live" && segments[1]) {
    return { videoId: segments[1], kind: "live" };
  }
  return null;
}

function findActiveVideoElement(kind: VideoKind): HTMLVideoElement | null {
  if (kind === "short") {
    const activeReelVideo = document.querySelector<HTMLVideoElement>(
      "ytd-reel-video-renderer[is-active] video"
    );
    if (activeReelVideo) {
      return activeReelVideo;
    }
  }
  return (
    document.querySelector<HTMLVideoElement>("video.html5-main-video") ??
    document.querySelector<HTMLVideoElement>("video")
  );
}

function normalizeYouTubeHref(href: string | null | undefined): string | undefined {
  if (!href) {
    return undefined;
  }
  const trimmed = href.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  if (trimmed.startsWith("/")) {
    return `https://www.youtube.com${trimmed}`;
  }
  return undefined;
}

function extractContext(
  route: RouteTarget,
  account: Account,
  videoEl: HTMLVideoElement | null
): PageVideoContext {
  const player = readPlayerDetails(route.videoId);
  let domTitle = "";
  let domChannelName = "";
  let domChannelUrl: string | undefined;
  let domDescription = "";

  if (route.kind === "short") {
    const reel = document.querySelector("ytd-reel-video-renderer[is-active]");
    domTitle =
      reel
        ?.querySelector(
          "h2.title yt-formatted-string, .ytShortsVideoTitleViewModelShortsVideoTitle, h2"
        )
        ?.textContent?.trim() ?? "";
    const channelLink = reel?.querySelector<HTMLAnchorElement>(
      "ytd-channel-name a, a[href^='/@'], a[href^='/channel/']"
    );
    domChannelName = channelLink?.textContent?.trim() ?? "";
    domChannelUrl = normalizeYouTubeHref(channelLink?.getAttribute("href"));
  } else {
    domTitle =
      document
        .querySelector("ytd-watch-metadata h1 yt-formatted-string, h1.ytd-watch-metadata")
        ?.textContent?.trim() ?? "";
    const channelLink = document.querySelector<HTMLAnchorElement>(
      "ytd-watch-metadata ytd-channel-name a"
    );
    domChannelName = channelLink?.textContent?.trim() ?? "";
    domChannelUrl = normalizeYouTubeHref(channelLink?.getAttribute("href"));
    domDescription =
      document
        .querySelector("#description-inline-expander yt-attributed-string, #description-inline-expander")
        ?.textContent?.trim() ??
      document.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() ??
      "";
  }

  const fallbackDocTitle = document.title.replace(/\s*-\s*YouTube\s*$/, "").trim();
  const title = player?.title || domTitle || fallbackDocTitle;
  const channelName = player?.author || domChannelName || undefined;
  const channelUrl =
    domChannelUrl ??
    (player?.channelId ? `https://www.youtube.com/channel/${player.channelId}` : undefined);
  const kind: VideoKind =
    route.kind === "short"
      ? "short"
      : route.kind === "live" || player?.isLiveContent
        ? "live"
        : "video";

  const rawVideoDuration = videoEl?.duration;
  const durationSeconds =
    rawVideoDuration !== undefined && Number.isFinite(rawVideoDuration) && rawVideoDuration > 0
      ? rawVideoDuration
      : player?.lengthSeconds;

  const rawDesc = player?.shortDescription || domDescription;
  const descriptionSnippet = rawDesc
    ? rawDesc.trim().slice(0, DESCRIPTION_SNIPPET_MAX_LENGTH)
    : undefined;

  return {
    videoId: route.videoId,
    title,
    channelName,
    channelUrl,
    kind,
    durationSeconds,
    descriptionSnippet,
    accountId: account.accountId,
    accountLabel: account.label
  };
}

export function startYouTubeObserver(
  library: HistoryLibrary,
  tracker: PlaybackTracker,
  onRecorded?: () => void
): YouTubeObserverHandle {
  let boundVideo: HTMLVideoElement | null = null;
  let stopped = false;
  // Media events also drive tracking when background interval callbacks are delayed.
  const playbackEvents = ["play", "playing", "pause", "ended", "waiting", "loadedmetadata", "timeupdate"];

  const readPlaybackState = (videoEl: HTMLVideoElement | null) => ({
    playing: Boolean(videoEl && !videoEl.paused && !videoEl.ended && videoEl.readyState > 1),
    visible: document.visibilityState === "visible",
    durationSeconds:
      videoEl && Number.isFinite(videoEl.duration) && videoEl.duration > 0
        ? videoEl.duration
        : undefined
  });

  const syncNow = () => {
    if (stopped) {
      return;
    }
    const now = Date.now();
    const route = parseRouteTarget();
    if (!route) {
      unbindVideo();
      tracker.onNavigate(null, now);
      return;
    }

    const videoEl = findActiveVideoElement(route.kind);
    bindVideo(videoEl);

    const account = readYtCfgAccount();
    const context = extractContext(route, account, videoEl);
    tracker.onNavigate(context, now);
    tracker.onPlaybackStateChange(readPlaybackState(videoEl), now);

    const observation = tracker.tick(now);
    if (observation) {
      void library.recordWatches([observation]).then(() => {
        onRecorded?.();
      });
    }
  };

  const handleVideoEvent = () => {
    if (stopped) {
      return;
    }
    const now = Date.now();
    tracker.onPlaybackStateChange(readPlaybackState(boundVideo), now);
    const observation = tracker.tick(now);
    if (observation) {
      void library.recordWatches([observation]).then(() => {
        onRecorded?.();
      });
    }
  };

  const unbindVideo = () => {
    if (!boundVideo) {
      return;
    }
    for (const evt of playbackEvents) {
      boundVideo.removeEventListener(evt, handleVideoEvent);
    }
    boundVideo = null;
  };

  const bindVideo = (nextVideo: HTMLVideoElement | null) => {
    if (nextVideo === boundVideo) {
      return;
    }
    unbindVideo();
    boundVideo = nextVideo;
    if (boundVideo) {
      for (const evt of playbackEvents) {
        boundVideo.addEventListener(evt, handleVideoEvent);
      }
    }
  };

  const handleNavigate = () => {
    syncNow();
  };

  const handleVisibility = () => {
    handleVideoEvent();
  };

  window.addEventListener("yt-navigate-finish", handleNavigate);
  window.addEventListener("popstate", handleNavigate);
  document.addEventListener("visibilitychange", handleVisibility);

  const intervalId = window.setInterval(syncNow, 1_000);
  syncNow();

  return {
    getCurrentAccount() {
      return readYtCfgAccount();
    },
    stop() {
      stopped = true;
      window.clearInterval(intervalId);
      window.removeEventListener("yt-navigate-finish", handleNavigate);
      window.removeEventListener("popstate", handleNavigate);
      document.removeEventListener("visibilitychange", handleVisibility);
      unbindVideo();
    }
  };
}
