import type { StorageAdapter } from "../domain/types.js";

export function createFireMonkeyStorageAdapter(): StorageAdapter {
  let writeQueue: Promise<unknown> = Promise.resolve();

  const serializeWrite = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = writeQueue.then(fn, fn);
    writeQueue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  };

  return {
    async withExclusiveLock<T>(task: () => Promise<T>): Promise<T> {
      // All matched pages use https://www.youtube.com. Never silently fall back
      // to an unsafe per-tab lock when Web Locks are unavailable.
      if (!navigator.locks) {
        throw new Error("Cross-tab history storage requires the Web Locks API.");
      }
      // Firefox's Web Locks invokes its callback across a compartment boundary.
      // Export the callback itself and return a window-realm Promise. The Lock
      // argument comes from the browser's compartment; we accept but never use it.
      // Only completion crosses this boundary, never history or error objects.
      let outcome: { value: T } | { error: unknown } | undefined;
      const acquired = () => {
        return new window.Promise<void>((release) => {
          void Promise.resolve().then(task).then(
            (value) => {
              outcome = { value };
              release();
            },
            (error: unknown) => { outcome = { error }; release(); }
          );
        });
      };
      const callback = typeof exportFunction === "function" && typeof unsafeWindow !== "undefined"
        ? exportFunction(acquired, unsafeWindow, { allowCrossOriginArguments: true })
        : acquired;
      await navigator.locks.request("youtube-history-search:storage:v1", callback);
      if (!outcome) throw new Error("History storage lock completed without running its task.");
      if ("error" in outcome) throw outcome.error;
      return outcome.value;
    },

    async publishChange() {
      await GM.setValue("yths:revision", crypto.randomUUID());
    },

    async subscribe(listener) {
      const id = await GM.addValueChangeListener("yths:revision", (_key, _old, _next, remote) => {
        if (remote) listener();
      });
      return () => { void GM.removeValueChangeListener(id); };
    },

    async get<T>(key: string): Promise<T | undefined> {
      const value = await GM.getValue<T | undefined>(key, undefined);
      return value;
    },

    async getMany(keys: string[]): Promise<Record<string, unknown>> {
      if (keys.length === 0) {
        return {};
      }
      if (typeof GM.getValues === "function") {
        try {
          const result = await GM.getValues(keys);
          if (result && typeof result === "object") {
            return result;
          }
        } catch {
          // Fall back to sequential GM.getValue reads
        }
      }
      const out: Record<string, unknown> = {};
      for (const key of keys) {
        const val = await GM.getValue<unknown>(key, undefined);
        if (val !== undefined) {
          out[key] = val;
        }
      }
      return out;
    },

    async set<T>(key: string, value: T): Promise<void> {
      return serializeWrite(() => GM.setValue(key, value));
    },

    async setMany(entries: Record<string, unknown>): Promise<void> {
      return serializeWrite(async () => {
        if (Object.keys(entries).length === 0) {
          return;
        }
        if (typeof GM.setValues === "function") {
          try {
            await GM.setValues(entries);
            return;
          } catch {
            // Fall back to sequential GM.setValue writes
          }
        }
        for (const [key, value] of Object.entries(entries)) {
          await GM.setValue(key, value);
        }
      });
    },

    async delete(key: string): Promise<void> {
      return serializeWrite(() => GM.deleteValue(key));
    }
  };
}
