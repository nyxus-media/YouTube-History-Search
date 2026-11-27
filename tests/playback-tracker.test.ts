import { describe, expect, test } from "vitest";
import { createPlaybackTracker } from "../src/domain/playback-tracker.js";

describe("PlaybackTracker", () => {
  test.each([true, false])("standard video emits once at 25,000ms of playback (visible=%s)", (visible) => {
    const tracker = createPlaybackTracker();

    tracker.onNavigate(
      {
        videoId: "dQw4w9WgXcQ",
        title: "Example Long Video",
        channelName: "Example Channel",
        channelUrl: "https://www.youtube.com/channel/UC123",
        kind: "video",
        durationSeconds: 180,
        accountId: "acc-1",
        accountLabel: "Personal"
      },
      1_000
    );

    tracker.onPlaybackStateChange(
      { playing: true, visible, durationSeconds: 180 },
      2_000
    );

    expect(tracker.tick(26_999)).toBeNull();

    const observation = tracker.tick(27_000);
    expect(observation).toEqual({
      videoId: "dQw4w9WgXcQ",
      title: "Example Long Video",
      channelName: "Example Channel",
      channelUrl: "https://www.youtube.com/channel/UC123",
      kind: "video",
      durationSeconds: 180,
      accountId: "acc-1",
      accountLabel: "Personal",
      watchedAt: 2_000,
      source: "live",
      timestampPrecision: "exact"
    });

    // Never emits a second time on later ticks during the same visit
    expect(tracker.tick(40_000)).toBeNull();
  });

  test("focus changes preserve accumulated playback while pauses do not count", () => {
    const tracker = createPlaybackTracker();
    tracker.onNavigate({ videoId: "background", title: "Background", durationSeconds: 300, accountId: "acc-1" }, 0);
    tracker.onPlaybackStateChange({ playing: true, visible: true }, 1_000);
    // Ten seconds in the foreground, followed by five in the background.
    tracker.onPlaybackStateChange({ playing: true, visible: false }, 11_000);
    tracker.onPlaybackStateChange({ playing: false, visible: false }, 16_000);
    expect(tracker.tick(100_000)).toBeNull();
    // Merely focusing a paused tab must not start its timer.
    tracker.onPlaybackStateChange({ playing: false, visible: true }, 100_000);
    expect(tracker.tick(200_000)).toBeNull();
    // Resume in the background; ten more seconds reaches the original threshold.
    tracker.onPlaybackStateChange({ playing: true, visible: false }, 200_000);
    expect(tracker.tick(209_999)).toBeNull();
    expect(tracker.tick(210_000)).toMatchObject({ videoId: "background", watchedAt: 1_000 });
    tracker.onPlaybackStateChange({ playing: true, visible: true }, 220_000);
    expect(tracker.tick(230_000)).toBeNull();
  });

  test("a delayed background tick records once and preserves the start timestamp", () => {
    const tracker = createPlaybackTracker();
    tracker.onNavigate({ videoId: "delayed", title: "Delayed", accountId: "acc-1" }, 0);
    tracker.onPlaybackStateChange({ playing: true, visible: false }, 1_000);
    expect(tracker.tick(61_000)).toMatchObject({ videoId: "delayed", watchedAt: 1_000 });
    expect(tracker.tick(120_000)).toBeNull();
  });

  test.each([true, false])("short-video thresholds remain unchanged (visible=%s)", (visible) => {
    const tracker = createPlaybackTracker();

    // 15s Short -> 12,000ms threshold
    tracker.onNavigate(
      {
        videoId: "short-15",
        title: "15s Short",
        kind: "short",
        durationSeconds: 15,
        accountId: "acc-1"
      },
      0
    );
    tracker.onPlaybackStateChange({ playing: true, visible, durationSeconds: 15 }, 1_000);
    expect(tracker.tick(12_999)).toBeNull();
    expect(tracker.tick(13_000)?.videoId).toBe("short-15");

    // 2s clip -> 3,000ms floor (not 1,600ms)
    tracker.onNavigate(
      {
        videoId: "clip-2",
        title: "2s Clip",
        kind: "short",
        durationSeconds: 2,
        accountId: "acc-1"
      },
      20_000
    );
    tracker.onPlaybackStateChange({ playing: true, visible, durationSeconds: 2 }, 20_000);
    expect(tracker.tick(22_999)).toBeNull();
    expect(tracker.tick(23_000)?.videoId).toBe("clip-2");

    // 25s video -> 25,000ms (not 20,000ms)
    tracker.onNavigate(
      {
        videoId: "vid-25",
        title: "25s Video",
        kind: "video",
        durationSeconds: 25,
        accountId: "acc-1"
      },
      30_000
    );
    tracker.onPlaybackStateChange({ playing: true, visible, durationSeconds: 25 }, 30_000);
    expect(tracker.tick(54_999)).toBeNull();
    expect(tracker.tick(55_000)?.videoId).toBe("vid-25");
  });

  test("same-video metadata enrichment preserves timer/emit guard while changing videoId, accountId, or null resets", () => {
    const tracker = createPlaybackTracker();

    tracker.onNavigate(
      {
        videoId: "vid-async",
        title: "Loading...",
        accountId: "acc-1"
      },
      0
    );
    tracker.onPlaybackStateChange({ playing: true, visible: true }, 1_000);

    // 10s elapsed, then async DOM hydration calls onNavigate with same (accountId, videoId)
    expect(tracker.tick(11_000)).toBeNull();
    tracker.onNavigate(
      {
        videoId: "vid-async",
        title: "Real Hydrated Title",
        channelName: "Hydrated Channel",
        channelUrl: "https://www.youtube.com/channel/UC999",
        kind: "video",
        durationSeconds: 120,
        descriptionSnippet: "Loaded description",
        accountId: "acc-1",
        accountLabel: "Work"
      },
      11_000
    );

    // Should preserve accumulated 10s and emit after 15s more (at 26_000) with enriched metadata
    expect(tracker.tick(25_999)).toBeNull();
    const firstEmit = tracker.tick(26_000);
    expect(firstEmit).toMatchObject({
      videoId: "vid-async",
      title: "Real Hydrated Title",
      channelName: "Hydrated Channel",
      descriptionSnippet: "Loaded description",
      accountId: "acc-1",
      accountLabel: "Work",
      watchedAt: 1_000
    });

    // Calling onNavigate again with same (accountId, videoId) must NOT re-emit
    tracker.onNavigate(
      {
        videoId: "vid-async",
        title: "Updated Title Again",
        accountId: "acc-1"
      },
      30_000
    );
    expect(tracker.tick(60_000)).toBeNull();

    // Switching accountId on the same videoId MUST reset and emit for the new account
    tracker.onNavigate(
      {
        videoId: "vid-async",
        title: "Real Hydrated Title",
        durationSeconds: 120,
        accountId: "acc-2"
      },
      61_000
    );
    tracker.onPlaybackStateChange({ playing: true, visible: true, durationSeconds: 120 }, 61_000);
    expect(tracker.tick(85_999)).toBeNull();
    expect(tracker.tick(86_000)?.accountId).toBe("acc-2");

    // Navigating to null clears state cleanly
    tracker.onNavigate(null, 90_000);
    tracker.onPlaybackStateChange({ playing: true, visible: true }, 90_000);
    expect(tracker.tick(120_000)).toBeNull();
  });

  test("invalid or unknown durations use 25,000ms threshold and trim/cap descriptionSnippet at 500 chars", () => {
    const tracker = createPlaybackTracker();
    const rawDescription = "   " + "x".repeat(520) + "   ";

    for (const badDuration of [undefined, Number.NaN, Number.POSITIVE_INFINITY, 0, -5]) {
      tracker.onNavigate(
        {
          videoId: `live-${String(badDuration)}`,
          title: "Livestream or Unknown Duration",
          kind: "live",
          durationSeconds: badDuration,
          descriptionSnippet: rawDescription,
          accountId: "acc-1"
        },
        0
      );
      tracker.onPlaybackStateChange(
        { playing: true, visible: true, durationSeconds: badDuration },
        1_000
      );
      expect(tracker.tick(25_999)).toBeNull();
      const obs = tracker.tick(26_000);
      expect(obs).not.toBeNull();
      expect(obs?.durationSeconds).toBeUndefined();
      expect(obs?.descriptionSnippet).toBe("x".repeat(500));
    }
  });
});
