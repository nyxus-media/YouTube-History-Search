import { createHistoryLibrary } from "../domain/history-library.js";
import { createPlaybackTracker } from "../domain/playback-tracker.js";
import { createFireMonkeyStorageAdapter } from "./firemonkey-storage.js";
import { mountHistorySearchModal } from "./search-modal.js";
import { startYouTubeObserver } from "./youtube-observer.js";

async function bootstrap(): Promise<void> {
  const storage = createFireMonkeyStorageAdapter();
  const library = createHistoryLibrary(storage);
  await library.load();

  const tracker = createPlaybackTracker();
  let modalHandle: ReturnType<typeof mountHistorySearchModal> | null = null;

  const observerHandle = startYouTubeObserver(library, tracker, () => {
    modalHandle?.refreshIfOpen();
  });

  modalHandle = mountHistorySearchModal(library, () => observerHandle.getCurrentAccount());
}

void bootstrap().catch((err: unknown) => {
  console.error("[youtube-history-search] Failed to initialize:", err);
});
