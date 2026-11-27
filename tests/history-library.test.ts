import { describe, expect, test } from "vitest";
import { createHistoryLibrary } from "../src/domain/history-library.js";
import { BLANK_ACCOUNT_ID } from "../src/domain/types.js";
import { InMemoryStorageAdapter } from "./in-memory-storage.js";

describe("HistoryLibrary", () => {
  test("recordWatches stores live observations and search returns flat rows with account labels", async () => {
    const storage = new InMemoryStorageAdapter();
    const library = createHistoryLibrary(storage);
    await library.load();

    const summary = await library.recordWatches([
      {
        videoId: "abc12345678",
        title: "Deep Modules Explained",
        channelName: "Code Design",
        channelUrl: "https://www.youtube.com/@codedesign",
        kind: "video",
        durationSeconds: 612,
        descriptionSnippet: "A talk about interfaces and leverage.",
        accountId: "acc-personal",
        accountLabel: "Personal",
        watchedAt: 1_700_000_000_000,
        source: "live",
        timestampPrecision: "exact"
      },
      {
        videoId: "xyz98765432",
        title: "Signed Out Watch",
        accountId: "",
        watchedAt: 1_700_005_000_000,
        source: "live",
        timestampPrecision: "exact"
      }
    ]);

    expect(summary).toEqual({ imported: 2, deduplicated: 0 });

    const result = library.search("");
    expect(result.totalMatches).toBe(2);
    expect(result.items).toEqual([
      {
        rowType: "watch",
        accountLabel: BLANK_ACCOUNT_ID,
        watch: {
          videoId: "xyz98765432",
          accountId: BLANK_ACCOUNT_ID,
          watchedAt: 1_700_005_000_000,
          source: "live",
          timestampPrecision: "exact"
        },
        video: {
          videoId: "xyz98765432",
          title: "Signed Out Watch",
          channelName: "",
          channelUrl: "",
          kind: "video"
        }
      },
      {
        rowType: "watch",
        accountLabel: "Personal",
        watch: {
          videoId: "abc12345678",
          accountId: "acc-personal",
          watchedAt: 1_700_000_000_000,
          source: "live",
          timestampPrecision: "exact"
        },
        video: {
          videoId: "abc12345678",
          title: "Deep Modules Explained",
          channelName: "Code Design",
          channelUrl: "https://www.youtube.com/@codedesign",
          kind: "video",
          durationSeconds: 612,
          descriptionSnippet: "A talk about interfaces and leverage."
        }
      }
    ]);
  });

  test("rewatches > 30 minutes apart stay separate flat rows, <= 30 minutes same account coalesce, and different accounts never coalesce", async () => {
    const library = createHistoryLibrary(new InMemoryStorageAdapter());
    await library.load();

    const t0 = 1_700_000_000_000;
    const thirtyMinMs = 30 * 60 * 1000;

    const resultSummary = await library.recordWatches([
      {
        videoId: "vid-1",
        title: "Rewatched Song",
        accountId: "acc-1",
        accountLabel: "Personal",
        watchedAt: t0,
        source: "live",
        timestampPrecision: "exact"
      },
      // Exactly 30 minutes later on same account -> coalesces
      {
        videoId: "vid-1",
        title: "Rewatched Song",
        accountId: "acc-1",
        watchedAt: t0 + thirtyMinMs,
        source: "live",
        timestampPrecision: "exact"
      },
      // 30 minutes + 1ms later on same account -> separate flat row
      {
        videoId: "vid-1",
        title: "Rewatched Song",
        accountId: "acc-1",
        watchedAt: t0 + thirtyMinMs + 1,
        source: "live",
        timestampPrecision: "exact"
      },
      // 5 minutes later on different account -> separate flat row
      {
        videoId: "vid-1",
        title: "Rewatched Song",
        accountId: "acc-2",
        accountLabel: "Work",
        watchedAt: t0 + 5 * 60 * 1000,
        source: "live",
        timestampPrecision: "exact"
      }
    ]);

    expect(resultSummary).toEqual({ imported: 3, deduplicated: 1 });

    const search = library.search("");
    expect(search.totalMatches).toBe(3);
    expect(
      search.items.map((item) =>
        item.rowType === "watch" ? [item.watch.accountId, item.watch.watchedAt] : []
      )
    ).toEqual([
      ["acc-1", t0 + thirtyMinMs + 1],
      ["acc-2", t0 + 5 * 60 * 1000],
      ["acc-1", t0]
    ]);
  });

  test("canonical Video uses richer-wins merging across all flat rows and caps descriptionSnippet at 500 chars", async () => {
    const library = createHistoryLibrary(new InMemoryStorageAdapter());
    await library.load();

    // 1. Older sparse observation (e.g., Takeout-style, no duration/description, generic 'video' kind)
    await library.recordWatches([
      {
        videoId: "enrich-1",
        title: "Great Talk",
        accountId: "acc-1",
        watchedAt: 1_700_000_000_000,
        source: "takeout",
        timestampPrecision: "exact"
      }
    ]);

    // 2. Newer richer live observation (> 30m later) enriches canonical Video
    await library.recordWatches([
      {
        videoId: "enrich-1",
        title: "Great Talk",
        channelName: "Conf Channel",
        channelUrl: "https://www.youtube.com/@conf",
        kind: "live",
        durationSeconds: 3600,
        descriptionSnippet: "  " + "d".repeat(540),
        accountId: "acc-1",
        watchedAt: 1_700_005_000_000,
        source: "live",
        timestampPrecision: "exact"
      }
    ]);

    // 3. Even newer sparse observation must NOT overwrite richer fields
    await library.recordWatches([
      {
        videoId: "enrich-1",
        title: "",
        kind: "video",
        accountId: "acc-2",
        watchedAt: 1_700_010_000_000,
        source: "takeout",
        timestampPrecision: "exact"
      }
    ]);

    const result = library.search("");
    expect(result.totalMatches).toBe(3);

    const expectedVideo = {
      videoId: "enrich-1",
      title: "Great Talk",
      channelName: "Conf Channel",
      channelUrl: "https://www.youtube.com/@conf",
      kind: "live",
      durationSeconds: 3600,
      descriptionSnippet: "d".repeat(500)
    };

    for (const row of result.items) {
      expect(row.rowType).toBe("watch");
      expect(row.video).toEqual(expectedVideo);
    }
  });

  test("cross-source deduplication prefers exact over approximate timestamps and earliest for same precision", async () => {
    const library = createHistoryLibrary(new InMemoryStorageAdapter());
    await library.load();

    const base = 1_700_000_000_000;

    // 1. Approximate fehistory entry, then exact takeout within 30m -> exact replaces watchedAt & precision
    await library.recordWatches([
      {
        videoId: "vid-prec",
        title: "Precision Test",
        accountId: "acc-1",
        watchedAt: base + 10 * 60 * 1000,
        source: "fehistory",
        timestampPrecision: "approximate"
      }
    ]);
    const exactUpgrade = await library.recordWatches([
      {
        videoId: "vid-prec",
        title: "Precision Test",
        accountId: "acc-1",
        watchedAt: base + 12 * 60 * 1000,
        source: "takeout",
        timestampPrecision: "exact"
      }
    ]);
    expect(exactUpgrade).toEqual({ imported: 0, deduplicated: 1 });

    // Approximate arriving AFTER exact must NOT downgrade it
    await library.recordWatches([
      {
        videoId: "vid-prec",
        title: "Precision Test",
        accountId: "acc-1",
        watchedAt: base + 1_000,
        source: "fehistory",
        timestampPrecision: "approximate"
      }
    ]);

    // Exact live (base + 30s) followed by earlier exact takeout (base + 5s) -> keeps Math.min
    await library.recordWatches([
      {
        videoId: "vid-same-prec",
        title: "Same Precision",
        accountId: "acc-1",
        watchedAt: base + 30_000,
        source: "live",
        timestampPrecision: "exact"
      },
      {
        videoId: "vid-same-prec",
        title: "Same Precision",
        accountId: "acc-1",
        watchedAt: base + 5_000,
        source: "takeout",
        timestampPrecision: "exact"
      }
    ]);
    // Re-importing same observation stays idempotent
    const reimport = await library.recordWatches([
      {
        videoId: "vid-same-prec",
        title: "Same Precision",
        accountId: "acc-1",
        watchedAt: base + 5_000,
        source: "takeout",
        timestampPrecision: "exact"
      }
    ]);
    expect(reimport).toEqual({ imported: 0, deduplicated: 1 });

    const search = library.search("");
    expect(search.totalMatches).toBe(2);
    expect(
      search.items.map((row) => (row.rowType === "watch" ? row.watch : null))
    ).toEqual([
      {
        videoId: "vid-prec",
        accountId: "acc-1",
        watchedAt: base + 12 * 60 * 1000,
        source: "takeout",
        timestampPrecision: "exact"
      },
      {
        videoId: "vid-same-prec",
        accountId: "acc-1",
        watchedAt: base + 5_000,
        source: "takeout",
        timestampPrecision: "exact"
      }
    ]);
  });

  test("persists sharded state across reloads and moves cross-UTC-month deduped watches cleanly", async () => {
    const storage = new InMemoryStorageAdapter();
    const lib1 = createHistoryLibrary(storage);
    await lib1.load();

    // Month 1 (Jan 2025) and Month boundary watch (Feb 1 2025 00:05Z -> moves back to Jan 31 2025 23:55Z)
    const janMs = Date.UTC(2025, 0, 15, 12, 0, 0);
    const febBoundaryMs = Date.UTC(2025, 1, 1, 0, 5, 0);
    const janBoundaryMs = Date.UTC(2025, 0, 31, 23, 55, 0);

    await lib1.recordWatches([
      {
        videoId: "vid-jan",
        title: "January Video",
        channelName: "Winter Channel",
        kind: "short",
        durationSeconds: 18,
        accountId: "acc-1",
        accountLabel: "Personal",
        watchedAt: janMs,
        source: "live",
        timestampPrecision: "exact"
      },
      {
        videoId: "vid-boundary",
        title: "Midnight Crossing",
        accountId: "acc-1",
        watchedAt: febBoundaryMs,
        source: "fehistory",
        timestampPrecision: "approximate"
      }
    ]);

    // Exact timestamp in Jan (10m earlier) replaces approximate Feb timestamp across UTC month boundary
    await lib1.recordWatches([
      {
        videoId: "vid-boundary",
        title: "Midnight Crossing",
        accountId: "acc-1",
        watchedAt: janBoundaryMs,
        source: "takeout",
        timestampPrecision: "exact"
      }
    ]);

    // Reload into a brand-new HistoryLibrary instance using the same storage
    const lib2 = createHistoryLibrary(storage);
    await lib2.load();

    expect(lib2.listAccounts()).toEqual([{ accountId: "acc-1", label: "Personal" }]);

    const reloaded = lib2.search("");
    expect(reloaded.totalMatches).toBe(2);
    expect(reloaded.items).toEqual([
      {
        rowType: "watch",
        accountLabel: "Personal",
        video: {
          videoId: "vid-boundary",
          title: "Midnight Crossing",
          channelName: "",
          channelUrl: "",
          kind: "video"
        },
        watch: {
          videoId: "vid-boundary",
          accountId: "acc-1",
          watchedAt: janBoundaryMs,
          source: "takeout",
          timestampPrecision: "exact"
        }
      },
      {
        rowType: "watch",
        accountLabel: "Personal",
        video: {
          videoId: "vid-jan",
          title: "January Video",
          channelName: "Winter Channel",
          channelUrl: "",
          kind: "short",
          durationSeconds: 18
        },
        watch: {
          videoId: "vid-jan",
          accountId: "acc-1",
          watchedAt: janMs,
          source: "live",
          timestampPrecision: "exact"
        }
      }
    ]);
  });

  test("importTakeout parses watch-history.json formats, strips prefix, skips ads and linkless removals, and rejects malformed JSON", async () => {
    const library = createHistoryLibrary(new InMemoryStorageAdapter());
    await library.load();

    await expect(library.importTakeout("not-json", { accountId: "acc-1" })).rejects.toThrow();
    await expect(library.importTakeout('{"not":"an array"}', { accountId: "acc-1" })).rejects.toThrow();

    const takeoutEntries = [
      {
        header: "YouTube",
        title: "Watched Regular Talk",
        titleUrl: "https://www.youtube.com/watch?v=reg11111111",
        subtitles: [
          {
            name: "Tech Channel",
            url: "https://www.youtube.com/channel/UCtech"
          }
        ],
        time: "2026-02-01T10:00:00.000Z"
      },
      {
        header: "YouTube",
        title: "Watched Quick Short",
        titleUrl: "https://www.youtube.com/shorts/sht22222222",
        subtitles: [{ name: "Shorts Maker", url: "https://www.youtube.com/channel/UCshort" }],
        time: "2026-02-01T11:00:00.000Z"
      },
      {
        header: "YouTube",
        title: "Watched Live Stream",
        titleUrl: "https://www.youtube.com/live/liv33333333?feature=share",
        time: "2026-02-01T12:00:00.000Z"
      },
      {
        header: "YouTube Music",
        title: "Watched Synthwave Mix",
        titleUrl: "https://music.youtube.com/watch?v=mus44444444",
        subtitles: [{ name: "Artist Topic", url: "https://www.youtube.com/channel/UCmusic" }],
        time: "2026-02-01T13:00:00.000Z"
      },
      {
        header: "YouTube",
        title: "Watched Short Link",
        titleUrl: "https://youtu.be/ytu55555555",
        time: "2026-02-01T14:00:00.000Z"
      },
      {
        header: "YouTube",
        title: "Watched Removed Video Still Linked",
        titleUrl: "https://www.youtube.com/watch?v=rem66666666",
        time: "2026-02-01T15:00:00.000Z"
      },
      {
        header: "YouTube",
        title: "Watched a video that has been removed",
        time: "2026-02-01T16:00:00.000Z"
      },
      {
        header: "YouTube",
        title: "Watched Sponsored Ad Video",
        titleUrl: "https://www.youtube.com/watch?v=ads77777777",
        details: [{ name: "From Google Ads" }],
        time: "2026-02-01T17:00:00.000Z"
      },
      {
        header: "YouTube",
        title: "Watched Duplicate Within 30m",
        titleUrl: "https://www.youtube.com/watch?v=reg11111111",
        time: "2026-02-01T10:15:00.000Z"
      },
      {
        header: "YouTube",
        title: "Watched Bad Timestamp",
        titleUrl: "https://www.youtube.com/watch?v=bad88888888",
        time: "not-a-date"
      }
    ];

    const summary = await library.importTakeout(JSON.stringify(takeoutEntries), {
      accountId: "",
      accountLabel: "blank"
    });

    expect(summary).toEqual({
      totalEntries: 10,
      imported: 6,
      deduplicated: 1,
      skippedAds: 1,
      skippedRemoved: 1,
      skippedInvalid: 1
    });

    const result = library.search("");
    expect(result.totalMatches).toBe(6);
    expect(
      result.items.map((item) =>
        item.rowType === "watch"
          ? {
              videoId: item.video.videoId,
              title: item.video.title,
              kind: item.video.kind,
              accountId: item.watch.accountId,
              source: item.watch.source
            }
          : null
      )
    ).toEqual([
      {
        videoId: "rem66666666",
        title: "Removed Video Still Linked",
        kind: "video",
        accountId: "blank",
        source: "takeout"
      },
      {
        videoId: "ytu55555555",
        title: "Short Link",
        kind: "video",
        accountId: "blank",
        source: "takeout"
      },
      {
        videoId: "mus44444444",
        title: "Synthwave Mix",
        kind: "music",
        accountId: "blank",
        source: "takeout"
      },
      {
        videoId: "liv33333333",
        title: "Live Stream",
        kind: "live",
        accountId: "blank",
        source: "takeout"
      },
      {
        videoId: "sht22222222",
        title: "Quick Short",
        kind: "short",
        accountId: "blank",
        source: "takeout"
      },
      {
        videoId: "reg11111111",
        title: "Regular Talk",
        kind: "video",
        accountId: "blank",
        source: "takeout"
      }
    ]);
  });

  test("free-text search supports AND terms across title/channel/description, quotes, negation, inline regex, and regex mode", async () => {
    const library = createHistoryLibrary(new InMemoryStorageAdapter());
    await library.load();

    await library.recordWatches([
      {
        videoId: "s-1",
        title: "Rust Async Internals",
        channelName: "Systems Weekly",
        descriptionSnippet: "Deep dive into tokio futures and pin.",
        accountId: "acc-1",
        watchedAt: 1_700_001_000_000,
        source: "live",
        timestampPrecision: "exact"
      },
      {
        videoId: "s-2",
        title: "Beginner Rust Tutorial",
        channelName: "Quick Code",
        descriptionSnippet: "Learn cargo basics without async.",
        accountId: "acc-1",
        watchedAt: 1_700_002_000_000,
        source: "live",
        timestampPrecision: "exact"
      },
      {
        videoId: "s-3",
        title: "Zig Memory Allocators",
        channelName: "Systems Weekly",
        descriptionSnippet: "Comparing arena allocators vs Rust.",
        accountId: "acc-1",
        watchedAt: 1_700_003_000_000,
        source: "live",
        timestampPrecision: "exact"
      }
    ]);

    const ids = (q: string, regex = false) =>
      library
        .search(q, { regex, strict: true })
        .items.map((item) => (item.rowType === "watch" ? item.video.videoId : ""));

    // Space-separated AND across title + channel + descriptionSnippet
    expect(ids("systems rust")).toEqual(["s-3", "s-1"]);
    expect(ids("tokio pin")).toEqual(["s-1"]);

    // Quoted exact phrase
    expect(ids('"rust async"')).toEqual(["s-1"]);
    expect(ids('"async rust"')).toEqual([]);

    // Negation of single term and quoted phrase
    expect(ids("rust -beginner")).toEqual(["s-3", "s-1"]);
    expect(ids('rust -"arena allocators"')).toEqual(["s-2", "s-1"]);

    // Inline regex token (and negated inline regex)
    expect(ids("/^(Rust|Zig)\\s/")).toEqual(["s-3", "s-1"]);
    expect(ids("/rust/i -/tutorial/i")).toEqual(["s-3", "s-1"]);

    // Explicit regex mode
    expect(ids("tokio|allocators", true)).toEqual(["s-3", "s-1"]);

    // Invalid regex returns queryError without throwing
    const badInline = library.search("/[unclosed/");
    expect(badInline.totalMatches).toBe(0);
    expect(badInline.items).toEqual([]);
    expect(badInline.queryError).toBeTruthy();

    const badOption = library.search("[unclosed", { regex: true });
    expect(badOption.totalMatches).toBe(0);
    expect(badOption.items).toEqual([]);
    expect(badOption.queryError).toBeTruthy();
  });

  test("broad default search matches any term with light stemming, word-start matching, and best-match ranking", async () => {
    const library = createHistoryLibrary(new InMemoryStorageAdapter());
    await library.load();

    const t0 = 1_700_000_000_000;
    const t1 = 1_700_010_000_000;
    const t2 = 1_700_020_000_000;
    const t3 = 1_700_030_000_000;
    const t4 = 1_700_040_000_000;

    await library.recordWatches([
      {
        videoId: "rs-prog",
        title: "Programmer vs RuneScape",
        accountId: "acc-1",
        watchedAt: t1,
        source: "takeout",
        timestampPrecision: "exact"
      },
      {
        videoId: "gim-bot",
        title: "OSRS Group Ironman Bot Farm",
        accountId: "acc-1",
        watchedAt: t0,
        source: "takeout",
        timestampPrecision: "exact"
      },
      {
        videoId: "both-line",
        title: "Both Sides of the Bottom Line",
        accountId: "acc-1",
        watchedAt: t2,
        source: "live",
        timestampPrecision: "exact"
      },
      {
        videoId: "robot-vac",
        title: "Robot Vacuum Review",
        accountId: "acc-1",
        watchedAt: t3,
        source: "live",
        timestampPrecision: "exact"
      },
      {
        videoId: "pasta",
        title: "Cooking Pasta",
        accountId: "acc-1",
        watchedAt: t4,
        source: "live",
        timestampPrecision: "exact"
      },
      {
        videoId: "code-vid",
        title: "Clean Coder Tips",
        descriptionSnippet: "Writing maintainable code.",
        accountId: "acc-1",
        watchedAt: t0 - 1_000,
        source: "live",
        timestampPrecision: "exact"
      }
    ]);

    const titleIds = (q: string) =>
      library
        .search(q)
        .items.map((item) => (item.rowType === "watch" ? item.video.videoId : ""));

    // Broad search finds both OSRS videos (sorted by relevance despite older timestamps)
    // and excludes "Both Sides...", "Robot...", and "Cooking Pasta".
    expect(titleIds('bots "group iron man" programming')).toEqual(["gim-bot", "rs-prog"]);

    // Stemming variants for bot/botting/botted/bots
    expect(titleIds("botting")).toEqual(["gim-bot"]);
    expect(titleIds("botted")).toEqual(["gim-bot"]);

    // Stemming variants for program/programs/programming/programmed/programmer/programmers
    expect(titleIds("program")).toEqual(["rs-prog"]);
    expect(titleIds("programs")).toEqual(["rs-prog"]);
    expect(titleIds("programmed")).toEqual(["rs-prog"]);
    expect(titleIds("programmers")).toEqual(["rs-prog"]);

    // Stemming for code/coding/coder
    expect(titleIds("coding")).toEqual(["code-vid"]);
    expect(titleIds("coded")).toEqual(["code-vid"]);

    // 4+ char prefix matches word starts; 3-char "bot" does not prefix-match "both"/"bottom"
    expect(titleIds("runesc")).toEqual(["rs-prog"]);
    expect(titleIds("prog")).toEqual(["rs-prog"]);
    expect(titleIds("bot")).toEqual(["gim-bot"]);
  });

  test("broad search supports space/hyphen-insensitive matching, stemmed phrases, reverse compounds, and multiword initialisms", async () => {
    const library = createHistoryLibrary(new InMemoryStorageAdapter());
    await library.load();

    const t0 = 1_700_000_000_000;

    await library.recordWatches([
      {
        videoId: "gi-space",
        title: "Group Iron Man Progress",
        accountId: "acc-1",
        watchedAt: t0 + 5_000,
        source: "live",
        timestampPrecision: "exact"
      },
      {
        videoId: "gi-joined",
        title: "Group Ironman Episode 1",
        accountId: "acc-1",
        watchedAt: t0 + 4_000,
        source: "live",
        timestampPrecision: "exact"
      },
      {
        videoId: "gi-hyphen",
        title: "Group Iron-Man Guide",
        accountId: "acc-1",
        watchedAt: t0 + 3_000,
        source: "live",
        timestampPrecision: "exact"
      },
      {
        videoId: "gi-acronym",
        title: "GIM Episode 1",
        accountId: "acc-1",
        watchedAt: t0 + 2_000,
        source: "live",
        timestampPrecision: "exact"
      },
      {
        videoId: "iron-challenge",
        title: "Iron Man Challenge",
        accountId: "acc-1",
        watchedAt: t0 + 1_000,
        source: "live",
        timestampPrecision: "exact"
      },
      {
        videoId: "regime",
        title: "Regime Change",
        accountId: "acc-1",
        watchedAt: t0 + 6_000,
        source: "live",
        timestampPrecision: "exact"
      }
    ]);

    const ids = (q: string) =>
      library
        .search(q)
        .items.map((item) => (item.rowType === "watch" ? item.video.videoId : ""));

    // Quoted "group iron man" matches spaced, joined, hyphenated, and whole-word GIM (never "Regime")
    expect(ids('"group iron man"')).toEqual([
      "gi-space",
      "gi-joined",
      "gi-hyphen",
      "gi-acronym"
    ]);

    // Unquoted "group iron man" also matches "GIM Episode 1" via 3+ word initialism and excludes "Regime"
    const unquoted = ids("group iron man");
    expect(unquoted).toContain("gi-acronym");
    expect(unquoted).not.toContain("regime");

    // Reverse compound matching: "ironman" matches "Iron Man Challenge", "Group Iron-Man Guide", and "Group Iron Man Progress"
    expect(new Set(ids("ironman"))).toEqual(
      new Set(["iron-challenge", "gi-joined", "gi-hyphen", "gi-space"])
    );
  });

  test("explicit OR / | and parentheses work in both strict and broad modes without treating OR as a search word", async () => {
    const library = createHistoryLibrary(new InMemoryStorageAdapter());
    await library.load();

    const t0 = 1_700_000_000_000;

    await library.recordWatches([
      {
        videoId: "rs-prog",
        title: "Programmer vs RuneScape",
        accountId: "acc-1",
        watchedAt: t0 + 3_000,
        source: "takeout",
        timestampPrecision: "exact"
      },
      {
        videoId: "rs-bot",
        title: "RuneScape Bot Guide",
        accountId: "acc-1",
        watchedAt: t0 + 2_000,
        source: "live",
        timestampPrecision: "exact"
      },
      {
        videoId: "gim-bot",
        title: "OSRS Group Ironman Bot Farm",
        accountId: "acc-1",
        watchedAt: t0 + 1_000,
        source: "takeout",
        timestampPrecision: "exact"
      },
      {
        videoId: "py-prog",
        title: "Python Programmer Tips",
        accountId: "acc-1",
        watchedAt: t0 + 4_000,
        source: "live",
        timestampPrecision: "exact"
      },
      {
        videoId: "or-word",
        title: "Either Or Logic Explained",
        accountId: "acc-1",
        watchedAt: t0 + 5_000,
        source: "live",
        timestampPrecision: "exact"
      }
    ]);

    const strictIds = (q: string) =>
      library
        .search(q, { strict: true })
        .items.map((item) => (item.rowType === "watch" ? item.video.videoId : ""));

    const broadIds = (q: string) =>
      library
        .search(q)
        .items.map((item) => (item.rowType === "watch" ? item.video.videoId : ""));

    // Strict mode enforces AND when OR is absent
    expect(strictIds('bots "group iron man" programming')).toEqual([]);

    // Strict mode OR / |
    expect(strictIds("bot OR programmer")).toEqual(["py-prog", "rs-prog", "rs-bot", "gim-bot"]);
    expect(strictIds("bot | programmer")).toEqual(["py-prog", "rs-prog", "rs-bot", "gim-bot"]);

    // Parentheses + AND in strict mode
    expect(strictIds("(bot OR programmer) runescape")).toEqual(["rs-prog", "rs-bot"]);

    // Broad mode OR does NOT treat "OR" as a search term (must not pull in "Either Or Logic Explained")
    const broadOr = broadIds('bots OR "group iron man" OR programming');
    expect(new Set(broadOr)).toEqual(new Set(["gim-bot", "rs-prog", "rs-bot", "py-prog"]));
    expect(broadOr).not.toContain("or-word");
  });

  test("hard filters, broad negations, and explicit sort overrides work cleanly with broad search", async () => {
    const library = createHistoryLibrary(new InMemoryStorageAdapter());
    await library.load();

    const t0 = 1_700_000_000_000;
    const hr = 60 * 60 * 1000;

    await library.recordWatches([
      {
        videoId: "gim-1",
        title: "Group Ironman Bot Programming",
        channelName: "OSRS Devs",
        kind: "video",
        accountId: "acc-1",
        accountLabel: "Personal",
        watchedAt: t0,
        source: "live",
        timestampPrecision: "exact"
      },
      {
        videoId: "gim-1",
        title: "Group Ironman Bot Programming",
        channelName: "OSRS Devs",
        kind: "video",
        accountId: "acc-1",
        accountLabel: "Personal",
        watchedAt: t0 + 1 * hr,
        source: "live",
        timestampPrecision: "exact"
      },
      {
        videoId: "prog-newer",
        title: "Programming Basics",
        channelName: "Code Academy",
        kind: "short",
        accountId: "acc-2",
        accountLabel: "Work",
        watchedAt: t0 + 5 * hr,
        source: "live",
        timestampPrecision: "exact"
      },
      {
        videoId: "neg-phrase",
        title: "Group Iron-Man Bot Showcase",
        channelName: "OSRS Devs",
        kind: "video",
        accountId: "acc-1",
        watchedAt: t0 + 4 * hr,
        source: "live",
        timestampPrecision: "exact"
      }
    ]);

    const ids = (q: string, opts?: Parameters<typeof library.search>[1]) =>
      library
        .search(q, opts)
        .items.map((item) => (item.rowType === "watch" ? item.video.videoId : item.video.videoId));

    // Negation -bot excludes all bot videos even though they match "programming"/"coding"
    expect(ids("programming -bot")).toEqual(["prog-newer"]);

    // Broad negated phrase -"iron man" excludes both Ironman and Iron-Man
    expect(ids("bot -\"iron man\"")).toEqual([]);

    // Structured filters remain strict hard constraints in broad mode
    expect(ids("bots programming type:short")).toEqual(["prog-newer"]);
    expect(ids("bots programming channel:\"OSRS Devs\" account:personal -showcase")).toEqual([
      "gim-1",
      "gim-1"
    ]);

    // Explicit sort overrides: newest puts 1-term prog-newer first, relevance puts 2-term gim-1 first
    expect(ids("bot programming -showcase", { sort: "relevance" })).toEqual([
      "gim-1",
      "gim-1",
      "prog-newer"
    ]);
    expect(ids("bot programming -showcase", { sort: "newest" })).toEqual([
      "prog-newer",
      "gim-1",
      "gim-1"
    ]);
    expect(ids("bot programming -showcase", { sort: "oldest" })).toEqual([
      "gim-1",
      "gim-1",
      "prog-newer"
    ]);

    // Collapsed most-watched respects broad query
    const collapsed = library.search("bot programming -showcase", { sort: "most-watched" });
    expect(
      collapsed.items.map((r) => (r.rowType === "collapsed" ? [r.video.videoId, r.watchCount] : []))
    ).toEqual([
      ["gim-1", 2],
      ["prog-newer", 1]
    ]);
  });

  test("structured filters channel:, account:, type:, -type:, and inclusive local-timezone after:/before: work in query and options", async () => {
    const library = createHistoryLibrary(new InMemoryStorageAdapter());
    await library.load();

    const startNov1 = new Date(2025, 10, 1, 0, 0, 0, 0).getTime();
    const endNov30 = new Date(2025, 10, 30, 23, 59, 59, 999).getTime();

    await library.recordWatches([
      {
        videoId: "f-before",
        title: "Just Before Nov",
        channelName: "Alpha Dev",
        kind: "video",
        accountId: "acc-1",
        accountLabel: "Personal",
        watchedAt: startNov1 - 1,
        source: "live",
        timestampPrecision: "exact"
      },
      {
        videoId: "f-start",
        title: "Start Of Nov",
        channelName: "Alpha Dev",
        kind: "short",
        accountId: "acc-1",
        accountLabel: "Personal",
        watchedAt: startNov1,
        source: "live",
        timestampPrecision: "exact"
      },
      {
        videoId: "f-mid",
        title: "Mid Nov Music",
        channelName: "Synth Studio",
        kind: "music",
        accountId: "",
        watchedAt: new Date(2025, 10, 15, 14, 0, 0, 0).getTime(),
        source: "takeout",
        timestampPrecision: "exact"
      },
      {
        videoId: "f-end",
        title: "End Of Nov Live",
        channelName: "Beta Ops",
        kind: "live",
        accountId: "acc-2",
        accountLabel: "Work Team",
        watchedAt: endNov30,
        source: "live",
        timestampPrecision: "exact"
      },
      {
        videoId: "f-after",
        title: "Just After Nov",
        channelName: "Beta Ops",
        kind: "video",
        accountId: "acc-2",
        accountLabel: "Work Team",
        watchedAt: endNov30 + 1,
        source: "live",
        timestampPrecision: "exact"
      }
    ]);

    const ids = (q: string, opts?: Parameters<typeof library.search>[1]) =>
      library
        .search(q, opts)
        .items.map((item) => (item.rowType === "watch" ? item.video.videoId : ""));

    // Inclusive local date range
    expect(ids("after:2025-11-01 before:2025-11-30")).toEqual(["f-end", "f-mid", "f-start"]);
    expect(ids("", { afterDate: "2025-11-01", beforeDate: "2025-11-30" })).toEqual([
      "f-end",
      "f-mid",
      "f-start"
    ]);

    // channel: quoted & unquoted + negation
    expect(ids('channel:"Alpha Dev"')).toEqual(["f-start", "f-before"]);
    expect(ids("-channel:beta")).toEqual(["f-mid", "f-start", "f-before"]);

    // account: by label (case-insensitive), exact accountId, and blank
    expect(ids("account:personal")).toEqual(["f-start", "f-before"]);
    expect(ids('account:"work team"')).toEqual(["f-after", "f-end"]);
    expect(ids("account:acc-2")).toEqual(["f-after", "f-end"]);
    expect(ids("account:blank")).toEqual(["f-mid"]);
    expect(ids("", { accountId: "blank" })).toEqual(["f-mid"]);

    // type: (video, short/shorts, live, music) and -type:
    expect(ids("type:short")).toEqual(["f-start"]);
    expect(ids("type:shorts")).toEqual(["f-start"]);
    expect(ids("type:music")).toEqual(["f-mid"]);
    expect(ids("type:live")).toEqual(["f-end"]);
    expect(ids("-type:short -type:music")).toEqual(["f-after", "f-end", "f-before"]);
    expect(ids("", { kind: "short" })).toEqual(["f-start"]);
  });

  test("sort modes newest, oldest, and collapsed most-watched respect active filters and tie-break by latestWatchedAt", async () => {
    const library = createHistoryLibrary(new InMemoryStorageAdapter());
    await library.load();

    const hr = 60 * 60 * 1000;
    const t0 = 1_700_000_000_000;

    await library.recordWatches([
      // Video A: 2 watches on acc-1, 1 watch on acc-2 (total 3 watches)
      {
        videoId: "vid-a",
        title: "Alpha Song",
        accountId: "acc-1",
        accountLabel: "Personal",
        watchedAt: t0 + 1 * hr,
        source: "live",
        timestampPrecision: "exact"
      },
      {
        videoId: "vid-a",
        title: "Alpha Song",
        accountId: "acc-1",
        accountLabel: "Personal",
        watchedAt: t0 + 3 * hr,
        source: "live",
        timestampPrecision: "exact"
      },
      {
        videoId: "vid-a",
        title: "Alpha Song",
        accountId: "acc-2",
        accountLabel: "Work",
        watchedAt: t0 + 5 * hr,
        source: "live",
        timestampPrecision: "exact"
      },
      // Video B: 2 watches on acc-1, latest at t0 + 10hr (newer than A's latest!)
      {
        videoId: "vid-b",
        title: "Beta Song",
        accountId: "acc-1",
        accountLabel: "Personal",
        watchedAt: t0 + 2 * hr,
        source: "live",
        timestampPrecision: "exact"
      },
      {
        videoId: "vid-b",
        title: "Beta Song",
        accountId: "acc-1",
        accountLabel: "Personal",
        watchedAt: t0 + 10 * hr,
        source: "live",
        timestampPrecision: "exact"
      },
      // Video C: 1 watch
      {
        videoId: "vid-c",
        title: "Gamma Clip",
        accountId: "acc-1",
        accountLabel: "Personal",
        watchedAt: t0 + 4 * hr,
        source: "live",
        timestampPrecision: "exact"
      }
    ]);

    const newest = library.search("", { sort: "newest" });
    expect(
      newest.items.map((r) => (r.rowType === "watch" ? [r.video.videoId, r.watch.watchedAt] : []))
    ).toEqual([
      ["vid-b", t0 + 10 * hr],
      ["vid-a", t0 + 5 * hr],
      ["vid-c", t0 + 4 * hr],
      ["vid-a", t0 + 3 * hr],
      ["vid-b", t0 + 2 * hr],
      ["vid-a", t0 + 1 * hr]
    ]);

    const oldest = library.search("", { sort: "oldest" });
    expect(
      oldest.items.map((r) => (r.rowType === "watch" ? [r.video.videoId, r.watch.watchedAt] : []))
    ).toEqual([
      ["vid-a", t0 + 1 * hr],
      ["vid-b", t0 + 2 * hr],
      ["vid-a", t0 + 3 * hr],
      ["vid-c", t0 + 4 * hr],
      ["vid-a", t0 + 5 * hr],
      ["vid-b", t0 + 10 * hr]
    ]);

    // Most watched across all accounts: vid-a (3) > vid-b (2) > vid-c (1)
    const mostWatchedAll = library.search("", { sort: "most-watched" });
    expect(mostWatchedAll.totalMatches).toBe(3);
    expect(mostWatchedAll.items).toEqual([
      {
        rowType: "collapsed",
        video: {
          videoId: "vid-a",
          title: "Alpha Song",
          channelName: "",
          channelUrl: "",
          kind: "video"
        },
        watchCount: 3,
        latestWatchedAt: t0 + 5 * hr,
        watches: [
          {
            accountLabel: "Work",
            watch: {
              videoId: "vid-a",
              accountId: "acc-2",
              watchedAt: t0 + 5 * hr,
              source: "live",
              timestampPrecision: "exact"
            }
          },
          {
            accountLabel: "Personal",
            watch: {
              videoId: "vid-a",
              accountId: "acc-1",
              watchedAt: t0 + 3 * hr,
              source: "live",
              timestampPrecision: "exact"
            }
          },
          {
            accountLabel: "Personal",
            watch: {
              videoId: "vid-a",
              accountId: "acc-1",
              watchedAt: t0 + 1 * hr,
              source: "live",
              timestampPrecision: "exact"
            }
          }
        ]
      },
      {
        rowType: "collapsed",
        video: {
          videoId: "vid-b",
          title: "Beta Song",
          channelName: "",
          channelUrl: "",
          kind: "video"
        },
        watchCount: 2,
        latestWatchedAt: t0 + 10 * hr,
        watches: [
          {
            accountLabel: "Personal",
            watch: {
              videoId: "vid-b",
              accountId: "acc-1",
              watchedAt: t0 + 10 * hr,
              source: "live",
              timestampPrecision: "exact"
            }
          },
          {
            accountLabel: "Personal",
            watch: {
              videoId: "vid-b",
              accountId: "acc-1",
              watchedAt: t0 + 2 * hr,
              source: "live",
              timestampPrecision: "exact"
            }
          }
        ]
      },
      {
        rowType: "collapsed",
        video: {
          videoId: "vid-c",
          title: "Gamma Clip",
          channelName: "",
          channelUrl: "",
          kind: "video"
        },
        watchCount: 1,
        latestWatchedAt: t0 + 4 * hr,
        watches: [
          {
            accountLabel: "Personal",
            watch: {
              videoId: "vid-c",
              accountId: "acc-1",
              watchedAt: t0 + 4 * hr,
              source: "live",
              timestampPrecision: "exact"
            }
          }
        ]
      }
    ]);

    // When filtered to acc-1, vid-a & vid-b both have 2 watches, so vid-b wins tie-break (latest t0+10hr > t0+3hr)
    const mostWatchedAcc1 = library.search("account:personal", { sort: "most-watched" });
    expect(
      mostWatchedAcc1.items.map((r) =>
        r.rowType === "collapsed" ? [r.video.videoId, r.watchCount] : []
      )
    ).toEqual([
      ["vid-b", 2],
      ["vid-a", 2],
      ["vid-c", 1]
    ]);
  });

  test("listAccounts and setAccountLabel update search results, account: filters, and persist across reload", async () => {
    const storage = new InMemoryStorageAdapter();
    const lib1 = createHistoryLibrary(storage);
    await lib1.load();

    await lib1.recordWatches([
      {
        videoId: "acc-v1",
        title: "First Video",
        accountId: "id-100",
        watchedAt: 1_700_000_000_000,
        source: "live",
        timestampPrecision: "exact"
      },
      {
        videoId: "acc-v2",
        title: "Second Video",
        accountId: "",
        watchedAt: 1_700_005_000_000,
        source: "live",
        timestampPrecision: "exact"
      }
    ]);

    expect(lib1.listAccounts()).toEqual([
      { accountId: "id-100", label: "id-100" },
      { accountId: "blank", label: "blank" }
    ]);

    await lib1.setAccountLabel("id-100", "Main Channel");
    await lib1.setAccountLabel("blank", "Guest Firefox");

    const updatedSearch = lib1.search('account:"main channel"');
    expect(updatedSearch.totalMatches).toBe(1);
    expect(updatedSearch.items[0]).toMatchObject({
      rowType: "watch",
      accountLabel: "Main Channel"
    });

    const lib2 = createHistoryLibrary(storage);
    await lib2.load();

    expect(lib2.listAccounts()).toEqual([
      { accountId: "id-100", label: "Main Channel" },
      { accountId: "blank", label: "Guest Firefox" }
    ]);
    expect(lib2.search('account:"guest firefox"').totalMatches).toBe(1);
    expect(lib2.search("account:blank").totalMatches).toBe(1);
  });

  test("exportBackup and importBackup restore cleanly and merge safely into existing history", async () => {
    const srcStorage = new InMemoryStorageAdapter();
    const srcLib = createHistoryLibrary(srcStorage);
    await srcLib.load();

    const tOld = 1_700_000_000_000;
    const tOverlapBackup = 1_700_050_000_000;
    const tOverlapLocal = 1_700_050_020_000; // 20s later (within 30m)
    const tNewLocal = 1_700_100_000_000;

    await srcLib.recordWatches([
      {
        videoId: "bk-1",
        title: "Old Sparse Watch",
        accountId: "acc-1",
        accountLabel: "Backup Personal",
        watchedAt: tOld,
        source: "takeout",
        timestampPrecision: "exact"
      },
      {
        videoId: "bk-2",
        title: "Shared Rich Video",
        channelName: "Backup Channel",
        channelUrl: "https://www.youtube.com/@bk",
        kind: "short",
        durationSeconds: 19,
        descriptionSnippet: "Backup description",
        accountId: "acc-1",
        accountLabel: "Backup Personal",
        watchedAt: tOverlapBackup,
        source: "takeout",
        timestampPrecision: "exact"
      }
    ]);

    const snapshot = srcLib.exportBackup();
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.accounts).toEqual([{ accountId: "acc-1", label: "Backup Personal" }]);
    expect(snapshot.videos).toHaveLength(2);
    expect(snapshot.watches).toHaveLength(2);

    const rawBackup = JSON.stringify(snapshot);

    // 1. Rejects malformed JSON or unsupported schemaVersion
    await expect(srcLib.importBackup("not-json")).rejects.toThrow();
    await expect(srcLib.importBackup(JSON.stringify({ schemaVersion: 99 }))).rejects.toThrow();

    // 2. Restore into a fresh empty library and verify reload persistence
    const emptyStorage = new InMemoryStorageAdapter();
    const restoredLib = createHistoryLibrary(emptyStorage);
    await restoredLib.load();
    const restoreSummary = await restoredLib.importBackup(rawBackup);
    expect(restoreSummary).toEqual({
      totalWatches: 2,
      importedWatches: 2,
      deduplicatedWatches: 0,
      videosMerged: 2,
      accountsMerged: 1
    });

    const restoredReloaded = createHistoryLibrary(emptyStorage);
    await restoredReloaded.load();
    expect(restoredReloaded.search("").totalMatches).toBe(2);

    // 3. Merge into an existing library with newer watch, overlapping watch, and custom label
    const targetStorage = new InMemoryStorageAdapter();
    const targetLib = createHistoryLibrary(targetStorage);
    await targetLib.load();

    await targetLib.recordWatches([
      {
        videoId: "bk-2",
        title: "Shared Rich Video",
        accountId: "acc-1",
        accountLabel: "My Custom Label",
        watchedAt: tOverlapLocal,
        source: "live",
        timestampPrecision: "exact"
      },
      {
        videoId: "local-new",
        title: "Brand New Local Watch",
        accountId: "acc-2",
        accountLabel: "Work",
        watchedAt: tNewLocal,
        source: "live",
        timestampPrecision: "exact"
      }
    ]);

    const mergeSummary = await targetLib.importBackup(rawBackup);
    expect(mergeSummary).toEqual({
      totalWatches: 2,
      importedWatches: 1,
      deduplicatedWatches: 1,
      videosMerged: 2,
      accountsMerged: 0
    });

    // Reload and verify: 3 total watches, custom label preserved, bk-2 enriched by backup's short/duration/description
    const verifiedLib = createHistoryLibrary(targetStorage);
    await verifiedLib.load();

    expect(verifiedLib.listAccounts()).toEqual([
      { accountId: "acc-1", label: "My Custom Label" },
      { accountId: "acc-2", label: "Work" }
    ]);

    const mergedResults = verifiedLib.search("");
    expect(mergedResults.totalMatches).toBe(3);
    expect(
      mergedResults.items.map((item) =>
        item.rowType === "watch"
          ? {
              videoId: item.video.videoId,
              kind: item.video.kind,
              durationSeconds: item.video.durationSeconds,
              watchedAt: item.watch.watchedAt,
              accountLabel: item.accountLabel
            }
          : null
      )
    ).toEqual([
      {
        videoId: "local-new",
        kind: "video",
        durationSeconds: undefined,
        watchedAt: tNewLocal,
        accountLabel: "Work"
      },
      {
        videoId: "bk-2",
        kind: "short",
        durationSeconds: 19,
        watchedAt: tOverlapBackup,
        accountLabel: "My Custom Label"
      },
      {
        videoId: "bk-1",
        kind: "video",
        durationSeconds: undefined,
        watchedAt: tOld,
        accountLabel: "My Custom Label"
      }
    ]);
  });

  test("sequential/batched shard flush survives async read-modify-write per-script storage without concurrent overwrites", async () => {
    let backingStore: Record<string, unknown> = {};
    const asyncRmwStorage = {
      async get<T>(key: string): Promise<T | undefined> {
        await new Promise((r) => setTimeout(r, 1));
        return key in backingStore ? (structuredClone(backingStore[key]) as T) : undefined;
      },
      async set<T>(key: string, value: T): Promise<void> {
        const snapshot = structuredClone(backingStore);
        await new Promise((r) => setTimeout(r, 1));
        snapshot[key] = structuredClone(value);
        backingStore = snapshot;
      },
      async delete(key: string): Promise<void> {
        const snapshot = structuredClone(backingStore);
        await new Promise((r) => setTimeout(r, 1));
        delete snapshot[key];
        backingStore = snapshot;
      }
    };

    const lib1 = createHistoryLibrary(asyncRmwStorage);
    await lib1.load();

    await lib1.recordWatches([
      {
        videoId: "rmw-1",
        title: "Programmer vs RuneScape",
        accountId: "acc-1",
        watchedAt: Date.UTC(2025, 0, 10),
        source: "takeout",
        timestampPrecision: "exact"
      },
      {
        videoId: "rmw-2",
        title: "February Video",
        accountId: "acc-1",
        watchedAt: Date.UTC(2025, 1, 10),
        source: "takeout",
        timestampPrecision: "exact"
      },
      {
        videoId: "rmw-3",
        title: "March Video",
        accountId: "acc-1",
        watchedAt: Date.UTC(2025, 2, 10),
        source: "takeout",
        timestampPrecision: "exact"
      }
    ]);

    const lib2 = createHistoryLibrary(asyncRmwStorage);
    await lib2.load();
    expect(lib2.search("").totalMatches).toBe(3);
    expect(lib2.search("Programmer vs RuneScape").totalMatches).toBe(1);
  });

  test("uses getMany and setMany batch storage methods when provided", async () => {
    const store = new Map<string, unknown>();
    let setManyCalls = 0;
    let getManyCalls = 0;

    const batchStorage = {
      async get<T>(key: string): Promise<T | undefined> {
        return store.has(key) ? (structuredClone(store.get(key)) as T) : undefined;
      },
      async set<T>(key: string, value: T): Promise<void> {
        store.set(key, structuredClone(value));
      },
      async delete(key: string): Promise<void> {
        store.delete(key);
      },
      async getMany(keys: string[]): Promise<Record<string, unknown>> {
        getManyCalls += 1;
        const out: Record<string, unknown> = {};
        for (const key of keys) {
          if (store.has(key)) {
            out[key] = structuredClone(store.get(key));
          }
        }
        return out;
      },
      async setMany(entries: Record<string, unknown>): Promise<void> {
        setManyCalls += 1;
        for (const [key, value] of Object.entries(entries)) {
          store.set(key, structuredClone(value));
        }
      }
    };

    const lib1 = createHistoryLibrary(batchStorage);
    await lib1.load();
    await lib1.recordWatches([
      {
        videoId: "batch-1",
        title: "Batch One",
        accountId: "acc-1",
        watchedAt: Date.UTC(2025, 4, 1),
        source: "takeout",
        timestampPrecision: "exact"
      },
      {
        videoId: "batch-2",
        title: "Batch Two",
        accountId: "acc-1",
        watchedAt: Date.UTC(2025, 5, 1),
        source: "takeout",
        timestampPrecision: "exact"
      }
    ]);

    const lib2 = createHistoryLibrary(batchStorage);
    await lib2.load();
    expect(setManyCalls).toBeGreaterThanOrEqual(1);
    expect(getManyCalls).toBeGreaterThanOrEqual(2);
    expect(lib2.search("").totalMatches).toBe(2);
  });

  test("stale open tab logging a live watch or label change does not overwrite another tab's Takeout import", async () => {
    const sharedStorage = new InMemoryStorageAdapter();
    const tab1 = createHistoryLibrary(sharedStorage);
    const tab2 = createHistoryLibrary(sharedStorage);
    await tab1.load();
    await tab2.load();

    // Tab 2 imports Takeout and labels acc-1
    await tab2.recordWatches([
      {
        videoId: "rs-prog",
        title: "Programmer vs RuneScape",
        accountId: "acc-1",
        watchedAt: Date.UTC(2025, 0, 10),
        source: "takeout",
        timestampPrecision: "exact"
      }
    ]);
    await tab2.setAccountLabel("acc-1", "Personal");

    // Tab 1 (opened earlier with stale state) logs a live watch and sets label on acc-2
    await tab1.recordWatches([
      {
        videoId: "live-now",
        title: "Random Video Today",
        accountId: "acc-2",
        watchedAt: Date.UTC(2026, 10, 21),
        source: "live",
        timestampPrecision: "exact"
      }
    ]);
    await tab1.setAccountLabel("acc-2", "Work");

    const tab3 = createHistoryLibrary(sharedStorage);
    await tab3.load();
    expect(tab3.search("").totalMatches).toBe(2);
    expect(tab3.search("Programmer vs RuneScape").totalMatches).toBe(1);
    expect(tab3.search("Random Video Today").totalMatches).toBe(1);
    expect(tab3.listAccounts()).toEqual([
      { accountId: "acc-1", label: "Personal" },
      { accountId: "acc-2", label: "Work" }
    ]);
  });

  test("broad ranking ties stemmed hits with exact hits by recency while multi-term hits still win, and ignores punctuation in plain terms", async () => {
    const library = createHistoryLibrary(new InMemoryStorageAdapter());
    await library.load();

    const obs: Parameters<typeof library.recordWatches>[0] = [];
    for (let i = 0; i < 60; i += 1) {
      obs.push({
        videoId: `old-${i}`,
        title: i % 2 === 0 ? `Old Programming Video ${i}` : `Old Bots Video ${i}`,
        accountId: "acc-1",
        watchedAt: 1_700_000_000_000 + i * 3_600_000,
        source: "takeout",
        timestampPrecision: "exact"
      });
    }
    obs.push(
      {
        videoId: "target-newer-stem",
        title: "Programmer vs RuneScape",
        accountId: "acc-1",
        watchedAt: 1_760_000_000_000,
        source: "takeout",
        timestampPrecision: "exact"
      },
      {
        videoId: "gim-oldest-2term",
        title: "OSRS Group Ironman Bot Farm",
        accountId: "acc-1",
        watchedAt: 1_690_000_000_000,
        source: "takeout",
        timestampPrecision: "exact"
      },
      {
        videoId: "hyphen-guide",
        title: "Group Iron-Man Guide",
        accountId: "acc-1",
        watchedAt: 1_695_000_000_000,
        source: "takeout",
        timestampPrecision: "exact"
      }
    );
    await library.recordWatches(obs);

    // 2-term match ranks #1 even when oldest, and newer stemmed 1-term hit ranks #2 ahead of 60 older exact 1-term hits
    const rankedTop50 = library.search('bots "group iron man" programming', {
      sort: "relevance",
      limit: 50
    });
    expect(rankedTop50.totalMatches).toBe(63);
    expect(rankedTop50.items.slice(0, 3).map((x) => x.video.videoId)).toEqual([
      "gim-oldest-2term",
      "target-newer-stem",
      "old-59"
    ]);

    // Punctuation in broad plain terms (bots, and programming.) still matches
    const punctuated = library.search('bots, "group iron man" programming.', {
      sort: "relevance",
      limit: 50
    });
    expect(punctuated.items.slice(0, 2).map((x) => x.video.videoId)).toEqual([
      "gim-oldest-2term",
      "target-newer-stem"
    ]);

    // Hyphenated unquoted term "iron-man" matches both "Group Ironman" and "Group Iron-Man"
    expect(
      new Set(library.search("iron-man").items.map((x) => x.video.videoId))
    ).toEqual(new Set(["gim-oldest-2term", "hyphen-guide"]));
  });
});
