import { afterEach, describe, expect, test, vi } from "vitest";
import { createHistoryLibrary } from "../src/domain/history-library.js";
import type { WatchObservation } from "../src/domain/types.js";
import { createFireMonkeyStorageAdapter } from "../src/userscript/firemonkey-storage.js";
import { startHistorySync } from "../src/userscript/history-sync.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function installEnvironment(bulk = true) {
  const values = new Map<string, unknown>();
  const listeners = new Map<number, (key: string, old: unknown, value: unknown, remote: boolean) => void>();
  let nextId = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const request = vi.fn((_name: string, task: () => Promise<unknown>) => {
    const next = queue.then(task, task);
    queue = next.catch(() => {});
    return next;
  });
  const getValue = vi.fn(async (key: string, fallback?: unknown) => structuredClone(values.get(key) ?? fallback));
  const setValue = vi.fn(async (key: string, value: unknown) => {
    const old = values.get(key);
    values.set(key, structuredClone(value));
    if (key === "yths:revision") {
      for (const listener of listeners.values()) listener(key, old, value, true);
    }
  });
  vi.stubGlobal("window", { Promise });
  vi.stubGlobal("navigator", { locks: { request } });
  vi.stubGlobal("GM", {
    getValue, setValue,
    deleteValue: async (key: string) => { values.delete(key); },
    ...(bulk ? {
      getValues: async (keys: string[]) => Object.fromEntries(await Promise.all(keys.map(async key => [key, await getValue(key)]))),
      setValues: async (entries: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(entries)) await setValue(key, value);
      }
    } : {}),
    addValueChangeListener: (_key: string, listener: (key: string, old: unknown, value: unknown, remote: boolean) => void) => {
      listeners.set(++nextId, listener);
      return nextId;
    },
    removeValueChangeListener: (id: number) => { listeners.delete(id); }
  });
  return { values, getValue, setValue, request, listeners };
}

function observation(id: string, accountId = "personal"): WatchObservation {
  return { videoId: id, title: id, accountId, watchedAt: 1_700_000_000_000, source: "live", timestampPrecision: "exact" };
}

afterEach(() => vi.unstubAllGlobals());

describe("cross-tab storage", () => {
  test("Firefox exports the callback and accepts the browser Lock argument", async () => {
    installEnvironment();
    const exported = new WeakSet<Function>();
    const target = {};
    vi.stubGlobal("unsafeWindow", target);
    vi.stubGlobal("exportFunction", (callback: () => Promise<void>, scope: object, options: unknown) => {
      expect(scope).toBe(target);
      expect(options).toEqual({ allowCrossOriginArguments: true });
      const wrapper = () => callback();
      exported.add(wrapper);
      return wrapper;
    });
    let released = false;
    vi.stubGlobal("navigator", { locks: {
      request: async (_name: string, callback: () => Promise<void>) => {
        if (!exported.has(callback)) throw new Error('Permission denied to access property "then"');
        expect(await callback()).toBeUndefined();
        released = true;
      }
    } });
    const storage = createFireMonkeyStorageAdapter();
    const gate = deferred();
    const started = deferred();
    const privateResult = { history: "private" };
    const saving = storage.withExclusiveLock!(async () => {
      started.resolve();
      await gate.promise;
      return privateResult;
    });
    await started.promise;
    expect(released).toBe(false);
    gate.resolve();
    expect(await saving).toBe(privateResult);
    expect(released).toBe(true);
    const error = new Error("storage failed");
    await expect(storage.withExclusiveLock!(() => { throw error; })).rejects.toBe(error);
  });

  test("Firefox lock callback returns a page-realm promise and keeps results private", async () => {
    installEnvironment();
    class PagePromise<T> extends Promise<T> {}
    vi.stubGlobal("window", { Promise: PagePromise });
    const gate = deferred();
    const started = deferred();
    let released = false;
    vi.stubGlobal("navigator", { locks: {
      request: async (_name: string, callback: () => Promise<unknown>) => {
        const result = callback();
        // Model the Firefox boundary: a userscript Promise is inaccessible.
        if (!(result instanceof PagePromise)) throw new Error('Permission denied to access property "then"');
        expect(await result).toBeUndefined();
        released = true;
      }
    } });
    const storage = createFireMonkeyStorageAdapter();
    const privateResult = { watches: ["private history"] };
    const saving = storage.withExclusiveLock!(async () => {
      started.resolve();
      await gate.promise;
      return privateResult;
    });
    await started.promise;
    expect(released).toBe(false);
    gate.resolve();
    expect(await saving).toBe(privateResult);
    expect(released).toBe(true);
    const error = new Error("private error");
    await expect(storage.withExclusiveLock!(() => { throw error; })).rejects.toBe(error);
  });

  test.each([true, false])("overlapping saves preserve both watches and accounts (bulk=%s)", async (bulk) => {
    installEnvironment(bulk);
    const a = createHistoryLibrary(createFireMonkeyStorageAdapter());
    const b = createHistoryLibrary(createFireMonkeyStorageAdapter());
    await Promise.all([a.load(), b.load()]);
    await Promise.all([
      a.recordWatches([observation("first", "account-a")]),
      b.recordWatches([observation("second", "account-b")])
    ]);
    const reader = createHistoryLibrary(createFireMonkeyStorageAdapter());
    await reader.load();
    expect(reader.search("").totalMatches).toBe(2);
    expect(reader.listAccounts().map(a => a.accountId).sort()).toEqual(["account-a", "account-b"]);
    expect(reader.exportBackup().videos).toHaveLength(2);
  });

  test("concurrent duplicates still coalesce", async () => {
    installEnvironment();
    const a = createHistoryLibrary(createFireMonkeyStorageAdapter());
    const b = createHistoryLibrary(createFireMonkeyStorageAdapter());
    await Promise.all([a.recordWatches([observation("same")]), b.recordWatches([observation("same")])]);
    await a.load();
    expect(a.search("").totalMatches).toBe(1);
  });

  test("backup merge and account edits share the watch-save lock", async () => {
    installEnvironment();
    const a = createHistoryLibrary(createFireMonkeyStorageAdapter());
    const b = createHistoryLibrary(createFireMonkeyStorageAdapter());
    await a.recordWatches([observation("backup")]);
    const backup = JSON.stringify(a.exportBackup());
    await Promise.all([
      a.importBackup(backup),
      b.recordWatches([observation("live")]),
      a.setAccountLabel("personal", "Renamed")
    ]);
    await b.load();
    expect(b.search("").totalMatches).toBe(2);
    expect(b.listAccounts()[0]?.label).toBe("Renamed");
  });

  test("failed writes release the lock and do not announce a completed save", async () => {
    const env = installEnvironment(false);
    const a = createHistoryLibrary(createFireMonkeyStorageAdapter());
    env.setValue.mockRejectedValueOnce(new Error("disk full"));
    await expect(a.recordWatches([observation("failed")])).rejects.toThrow("disk full");
    expect(env.values.has("yths:revision")).toBe(false);
    const b = createHistoryLibrary(createFireMonkeyStorageAdapter());
    await b.recordWatches([observation("saved")]);
    await a.load();
    expect(a.search("").totalMatches).toBe(1);
  });

  test("missing Web Locks fails safely before touching storage", async () => {
    const env = installEnvironment();
    vi.stubGlobal("navigator", {});
    const library = createHistoryLibrary(createFireMonkeyStorageAdapter());
    await expect(library.recordWatches([observation("unsafe")])).rejects.toThrow("Web Locks");
    expect(env.setValue).not.toHaveBeenCalled();
  });

  test("another tab's completed save reloads results without reopening the modal", async () => {
    const env = installEnvironment();
    const writer = createHistoryLibrary(createFireMonkeyStorageAdapter());
    const readerStorage = createFireMonkeyStorageAdapter();
    const reader = createHistoryLibrary(readerStorage);
    await reader.load();
    const refreshed = deferred();
    const counts: number[] = [];
    const stop = await startHistorySync(readerStorage, reader, () => {
      counts.push(reader.search("").totalMatches);
      refreshed.resolve();
    });
    await writer.recordWatches([observation("new-watch")]);
    await refreshed.promise;
    expect(counts).toEqual([1]);
    expect(reader.exportBackup().videos[0]?.title).toBe("new-watch");
    stop();
    expect(env.listeners.size).toBe(0);
  });

  test("changes arriving during a reload are not dropped", async () => {
    const gate = deferred();
    const finished = deferred();
    let changed!: () => void;
    const load = vi.fn().mockImplementationOnce(() => gate.promise).mockResolvedValue(undefined);
    let refreshes = 0;
    const stop = await startHistorySync({
      ...createFireMonkeyStorageAdapter(),
      subscribe: async (listener) => { changed = listener; return () => {}; }
    }, { load }, () => { if (++refreshes === 2) finished.resolve(); });
    changed();
    changed();
    changed();
    gate.resolve();
    await finished.promise;
    expect(load).toHaveBeenCalledTimes(2);
    stop();
  });

  test("a refresh failure does not prevent later notifications from refreshing", async () => {
    let changed!: () => void;
    const failed = deferred();
    const refreshed = deferred();
    const error = new Error("read failed");
    const load = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined);
    const onError = vi.fn(() => failed.resolve());
    const stop = await startHistorySync({
      ...createFireMonkeyStorageAdapter(),
      subscribe: async (listener) => { changed = listener; return () => {}; }
    }, { load }, () => refreshed.resolve(), onError);
    changed();
    await failed.promise;
    changed();
    await refreshed.promise;
    expect(onError).toHaveBeenCalledWith(error);
    expect(load).toHaveBeenCalledTimes(2);
    stop();
  });
});
