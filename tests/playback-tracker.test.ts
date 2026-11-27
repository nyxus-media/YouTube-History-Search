import { describe, expect, test } from "vitest";
import { createPlaybackTracker } from "../src/domain/playback-tracker.js";

describe("PlaybackTracker", () => {
  test("standard >= 25s video emits once at 25,000ms of active playback with startedPlayingAtMs", () => {
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
      { playing: true, visible: true, durationSeconds: 180 },
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

  test("visibility and pause gating accumulates only visible active playback segments", () => {
    const tracker = createPlaybackTracker();

    tracker.onNavigate(
      {
        videoId: "vid-pause",
        title: "Pausable Video",
        durationSeconds: 300,
        accountId: "acc-1"
      },
      0
    );

    // Playing while backgrounded should not count or set watchedAt
    tracker.onPlaybackStateChange({ playing: true, visible: false, durationSeconds: 300 }, 1_000);
    expect(tracker.tick(30_000)).toBeNull();

    // Segment 1: becomes visible & playing at 35_000 -> runs 10_000ms until paused at 45_000
    tracker.onPlaybackStateChange({ playing: true, visible: true, durationSeconds: 300 }, 35_000);
    expect(tracker.tick(44_999)).toBeNull();
    tracker.onPlaybackStateChange({ playing: false, visible: true, durationSeconds: 300 }, 45_000);
    // Elapsed while paused (45_000 -> 100_000) does not count
    expect(tracker.tick(100_000)).toBeNull();

    // Segment 2: resumes at 100_000 -> runs 10_000ms until hidden at 110_000 (total 20_000ms)
    tracker.onPlaybackStateChange({ playing: true, visible: true, durationSeconds: 300 }, 100_000);
    expect(tracker.tick(109_999)).toBeNull();
    tracker.onPlaybackStateChange({ playing: true, visible: false, durationSeconds: 300 }, 110_000);
    expect(tracker.tick(150_000)).toBeNull();

    // Segment 3: visible again at 150_000 -> needs 5_000ms more (emits at 155_000)
    tracker.onPlaybackStateChange({ playing: true, visible: true, durationSeconds: 300 }, 150_000);
    expect(tracker.tick(154_999)).toBeNull();

    const observation = tracker.tick(155_000);
    expect(observation?.watchedAt).toBe(35_000);
    expect(observation?.videoId).toBe("vid-pause");
  });

  test("short videos under 25s use 80% of duration with a 3,000ms floor, while 25s uses 25,000ms", () => {
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
    tracker.onPlaybackStateChange({ playing: true, visible: true, durationSeconds: 15 }, 1_000);
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
    tracker.onPlaybackStateChange({ playing: true, visible: true, durationSeconds: 2 }, 20_000);
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
    tracker.onPlaybackStateChange({ playing: true, visible: true, durationSeconds: 25 }, 30_000);
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
