import type { HistoryLibrary } from "../domain/history-library.js";
import type { StorageAdapter } from "../domain/types.js";

/** Coalesce bursts, but never drop a change that arrives during a reload. */
export async function startHistorySync(
  storage: StorageAdapter,
  library: Pick<HistoryLibrary, "load">,
  refresh: () => void,
  onError: (error: unknown) => void = (error) => console.error("[youtube-history-search] History refresh failed:", error)
): Promise<() => void> {
  let pending = false;
  let running = false;
  let stopped = false;
  const drain = async () => {
    if (running || stopped) return;
    running = true;
    try {
      while (pending && !stopped) {
        pending = false;
        await library.load();
        if (!stopped) refresh();
      }
    } catch (error) {
      onError(error);
    } finally {
      running = false;
      if (pending && !stopped) void drain();
    }
  };
  const unsubscribe = await storage.subscribe?.(() => {
    pending = true;
    void drain();
  });
  return () => {
    stopped = true;
    unsubscribe?.();
  };
}
