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
    async get<T>(key: string): Promise<T | undefined> {
      return (await GM.getValue<T | undefined>(key, undefined)) as T | undefined;
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
