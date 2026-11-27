import type { ImportSummary, VideoKind, WatchObservation } from "../types.js";

interface TakeoutRawEntry {
  header?: unknown;
  title?: unknown;
  titleUrl?: unknown;
  subtitles?: unknown;
  time?: unknown;
  details?: unknown;
}

export interface ParsedTakeoutResult {
  observations: WatchObservation[];
  counts: Omit<ImportSummary, "imported" | "deduplicated">;
}

function isGoogleAdsEntry(entry: TakeoutRawEntry): boolean {
  if (typeof entry.header === "string" && entry.header.toLowerCase().includes("google ads")) {
    return true;
  }
  if (!Array.isArray(entry.details)) {
    return false;
  }
  return entry.details.some((detail) => {
    if (!detail || typeof detail !== "object") {
      return false;
    }
    const name = (detail as { name?: unknown }).name;
    return typeof name === "string" && name.toLowerCase().includes("google ads");
  });
}

function extractVideoInfo(
  rawUrl: string,
  header: unknown
): { videoId: string; kind: VideoKind } | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const isMusicSource =
    (typeof header === "string" && header === "YouTube Music") || host === "music.youtube.com";

  if (host === "youtu.be") {
    const seg = parsed.pathname.split("/").filter(Boolean)[0];
    if (!seg) {
      return null;
    }
    return { videoId: seg, kind: isMusicSource ? "music" : "video" };
  }

  if (
    host !== "www.youtube.com" &&
    host !== "youtube.com" &&
    host !== "m.youtube.com" &&
    host !== "music.youtube.com"
  ) {
    return null;
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments[0] === "shorts" && segments[1]) {
    return { videoId: segments[1], kind: "short" };
  }
  if (segments[0] === "live" && segments[1]) {
    return { videoId: segments[1], kind: "live" };
  }
  if (segments[0] === "watch") {
    const v = parsed.searchParams.get("v")?.trim();
    if (!v) {
      return null;
    }
    return { videoId: v, kind: isMusicSource ? "music" : "video" };
  }

  return null;
}

export function parseTakeoutWatchHistory(
  rawJson: string,
  accountId: string,
  accountLabel?: string
): ParsedTakeoutResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error("Invalid Takeout JSON: unable to parse JSON");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Invalid Takeout JSON: expected an array of watch history entries");
  }

  const observations: WatchObservation[] = [];
  let skippedAds = 0;
  let skippedRemoved = 0;
  let skippedInvalid = 0;

  for (const item of parsed) {
    if (!item || typeof item !== "object") {
      skippedInvalid += 1;
      continue;
    }
    const entry = item as TakeoutRawEntry;

    if (isGoogleAdsEntry(entry)) {
      skippedAds += 1;
      continue;
    }

    if (typeof entry.titleUrl !== "string" || entry.titleUrl.trim().length === 0) {
      skippedRemoved += 1;
      continue;
    }

    if (typeof entry.time !== "string") {
      skippedInvalid += 1;
      continue;
    }
    const watchedAt = Date.parse(entry.time);
    if (Number.isNaN(watchedAt)) {
      skippedInvalid += 1;
      continue;
    }

    const videoInfo = extractVideoInfo(entry.titleUrl.trim(), entry.header);
    if (!videoInfo) {
      skippedInvalid += 1;
      continue;
    }

    const rawTitle = typeof entry.title === "string" ? entry.title : "";
    const title = (rawTitle.startsWith("Watched ") ? rawTitle.slice("Watched ".length) : rawTitle).trim();

    let channelName = "";
    let channelUrl = "";
    if (Array.isArray(entry.subtitles) && entry.subtitles.length > 0) {
      const firstSub = entry.subtitles[0];
      if (firstSub && typeof firstSub === "object") {
        const subObj = firstSub as { name?: unknown; url?: unknown };
        if (typeof subObj.name === "string") {
          channelName = subObj.name.trim();
        }
        if (typeof subObj.url === "string") {
          channelUrl = subObj.url.trim();
        }
      }
    }

    observations.push({
      videoId: videoInfo.videoId,
      title,
      channelName,
      channelUrl,
      kind: videoInfo.kind,
      accountId,
      accountLabel,
      watchedAt,
      source: "takeout",
      timestampPrecision: "exact"
    });
  }

  return {
    observations,
    counts: {
      totalEntries: parsed.length,
      skippedAds,
      skippedRemoved,
      skippedInvalid
    }
  };
}
