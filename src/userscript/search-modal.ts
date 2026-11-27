import type { HistoryLibrary } from "../domain/history-library.js";
import {
  BLANK_ACCOUNT_ID,
  type Account,
  type CollapsedSearchRow,
  type FlatSearchRow,
  type SortMode,
  type Video,
  type VideoKind
} from "../domain/types.js";

const STYLE_ID = "yths-styles";
const BAR_ID = "yths-history-bar";
const OPEN_BTN_ID = "yths-open-btn";
const MODAL_ID = "yths-modal-backdrop";
const PAGE_SIZE = 50;

const STYLES = `
#${BAR_ID} {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  margin: 12px 0 16px;
  border-radius: 10px;
  background: var(--yt-spec-badge-chip-background, rgba(128, 128, 128, 0.14));
  border: 1px solid var(--yt-spec-10-percent-layer, rgba(128, 128, 128, 0.25));
  color: var(--yt-spec-text-primary, #f1f1f1);
  font-family: Roboto, Arial, sans-serif;
  font-size: 14px;
  z-index: 2000;
}
#${BAR_ID}.yths-floating-fallback {
  position: fixed;
  top: 64px;
  right: 24px;
  margin: 0;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
}
#${OPEN_BTN_ID} {
  background: #065fd4;
  color: #ffffff;
  border: none;
  border-radius: 18px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
#${OPEN_BTN_ID}:hover {
  background: #0551b5;
}
#${MODAL_ID} {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.72);
  z-index: 99999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  font-family: Roboto, Arial, sans-serif;
}
.yths-modal {
  width: min(980px, 96vw);
  max-height: 90vh;
  background: #181818;
  color: #f1f1f1;
  border: 1px solid #303030;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
  font-size: 13px;
}
.yths-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid #2b2b2b;
  gap: 12px;
}
.yths-title-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
}
.yths-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.yths-count-pill {
  background: #272727;
  color: #aaaaaa;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
}
.yths-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.yths-btn {
  background: #272727;
  color: #f1f1f1;
  border: 1px solid #3d3d3d;
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
}
.yths-btn:hover {
  background: #383838;
}
.yths-btn-primary {
  background: #065fd4;
  border-color: #065fd4;
  color: #ffffff;
}
.yths-btn-primary:hover {
  background: #0551b5;
}
.yths-search-area {
  padding: 12px 18px;
  border-bottom: 1px solid #2b2b2b;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.yths-search-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.yths-input, .yths-select {
  background: #0f0f0f;
  color: #f1f1f1;
  border: 1px solid #3a3a3a;
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 13px;
}
.yths-search-input {
  flex: 1;
}
.yths-hint {
  color: #9e9e9e;
  font-size: 11px;
}
.yths-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.yths-filter-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #cccccc;
  font-size: 12px;
}
.yths-error {
  color: #ff8a80;
  background: rgba(255, 82, 82, 0.12);
  border: 1px solid rgba(255, 82, 82, 0.35);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 12px;
}
.yths-tools {
  padding: 12px 18px;
  background: #202020;
  border-bottom: 1px solid #2b2b2b;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.yths-tabs {
  display: flex;
  gap: 6px;
}
.yths-tab-active {
  background: #065fd4;
  border-color: #065fd4;
  color: #ffffff;
}
.yths-tool-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.yths-tool-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.yths-status {
  color: #a5d6a7;
  font-size: 12px;
}
.yths-results {
  flex: 1;
  overflow-y: auto;
  padding: 10px 18px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.yths-card {
  background: #212121;
  border: 1px solid #2e2e2e;
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.yths-card-title {
  color: #3ea6ff;
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;
}
.yths-card-title:hover {
  text-decoration: underline;
}
.yths-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  color: #aaaaaa;
  font-size: 12px;
}
.yths-channel-link {
  color: #dddddd;
  text-decoration: none;
}
.yths-channel-link:hover {
  text-decoration: underline;
}
.yths-badge {
  background: #2f2f2f;
  color: #d0d0d0;
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 11px;
}
.yths-snippet {
  color: #bbbbbb;
  font-size: 12px;
  line-height: 1.4;
  margin-top: 2px;
}
.yths-details {
  margin-top: 4px;
  font-size: 12px;
  color: #cccccc;
}
.yths-details summary {
  cursor: pointer;
  color: #3ea6ff;
}
.yths-watch-list {
  margin: 6px 0 0 16px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.yths-empty {
  color: #9e9e9e;
  text-align: center;
  padding: 28px 12px;
}
.yths-load-more {
  align-self: center;
  margin-top: 8px;
}
`;

function isHistoryPage(): boolean {
  const path = window.location.pathname;
  return path === "/feed/history" || path.startsWith("/feed/history/");
}

function ensureStylesInjected(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.append(style);
}

function buildVideoUrl(video: Video): string {
  if (video.kind === "short") {
    return `https://www.youtube.com/shorts/${encodeURIComponent(video.videoId)}`;
  }
  if (video.kind === "live") {
    return `https://www.youtube.com/live/${encodeURIComponent(video.videoId)}`;
  }
  return `https://www.youtube.com/watch?v=${encodeURIComponent(video.videoId)}`;
}

function formatDuration(seconds: number | undefined): string | null {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  const whole = Math.floor(seconds);
  const hrs = Math.floor(whole / 3600);
  const mins = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

function createBadge(text: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = "yths-badge";
  span.textContent = text;
  return span;
}

function createTitleLink(video: Video): HTMLAnchorElement {
  const link = document.createElement("a");
  link.className = "yths-card-title";
  link.href = buildVideoUrl(video);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = video.title || video.videoId;
  return link;
}

function createChannelNode(video: Video): HTMLElement {
  const label = video.channelName || "Unknown channel";
  if (video.channelUrl) {
    const a = document.createElement("a");
    a.className = "yths-channel-link";
    a.href = video.channelUrl;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = label;
    return a;
  }
  const span = document.createElement("span");
  span.textContent = label;
  return span;
}

function renderFlatRow(row: FlatSearchRow): HTMLElement {
  const card = document.createElement("div");
  card.className = "yths-card";

  card.append(createTitleLink(row.video));

  const meta = document.createElement("div");
  meta.className = "yths-card-meta";
  meta.append(createChannelNode(row.video));
  meta.append(createBadge(row.video.kind));

  const duration = formatDuration(row.video.durationSeconds);
  if (duration) {
    meta.append(createBadge(duration));
  }
  meta.append(createBadge(row.accountLabel));
  meta.append(createBadge(row.watch.source));

  const timeSpan = document.createElement("span");
  timeSpan.textContent = formatTimestamp(row.watch.watchedAt);
  meta.append(timeSpan);
  card.append(meta);

  if (row.video.descriptionSnippet) {
    const snippet = document.createElement("div");
    snippet.className = "yths-snippet";
    snippet.textContent = row.video.descriptionSnippet;
    card.append(snippet);
  }

  return card;
}

function renderCollapsedRow(row: CollapsedSearchRow): HTMLElement {
  const card = document.createElement("div");
  card.className = "yths-card";

  card.append(createTitleLink(row.video));

  const meta = document.createElement("div");
  meta.className = "yths-card-meta";
  meta.append(createChannelNode(row.video));
  meta.append(createBadge(`${row.watchCount} ${row.watchCount === 1 ? "watch" : "watches"}`));
  meta.append(createBadge(row.video.kind));

  const duration = formatDuration(row.video.durationSeconds);
  if (duration) {
    meta.append(createBadge(duration));
  }

  const latestSpan = document.createElement("span");
  latestSpan.textContent = `Latest: ${formatTimestamp(row.latestWatchedAt)}`;
  meta.append(latestSpan);
  card.append(meta);

  if (row.video.descriptionSnippet) {
    const snippet = document.createElement("div");
    snippet.className = "yths-snippet";
    snippet.textContent = row.video.descriptionSnippet;
    card.append(snippet);
  }

  const details = document.createElement("details");
  details.className = "yths-details";
  const summary = document.createElement("summary");
  summary.textContent = `Show watch dates (${row.watches.length})`;
  details.append(summary);

  const list = document.createElement("ul");
  list.className = "yths-watch-list";
  for (const entry of row.watches) {
    const li = document.createElement("li");
    li.textContent = `${formatTimestamp(entry.watch.watchedAt)} (${entry.accountLabel}, ${entry.watch.source})`;
    list.append(li);
  }
  details.append(list);
  card.append(details);

  return card;
}

function slugifyAccountId(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `takeout-${slug}` : `takeout-${Date.now()}`;
}

export interface SearchModalHandle {
  refreshIfOpen(): void;
  stop(): void;
}

export function mountHistorySearchModal(
  library: HistoryLibrary,
  getCurrentAccount: () => Account
): SearchModalHandle {
  let stopped = false;
  let openRefreshFn: (() => void) | null = null;
  let debounceTimer: number | null = null;

  const removeHistoryBar = () => {
    document.getElementById(BAR_ID)?.remove();
  };

  const openModal = () => {
    if (document.getElementById(MODAL_ID)) {
      return;
    }

    ensureStylesInjected();

    let currentLimit = PAGE_SIZE;
    let toolsVisible = false;
    let activeToolTab: "takeout" | "backup" | "accounts" = "takeout";

    const backdrop = document.createElement("div");
    backdrop.id = MODAL_ID;

    const modal = document.createElement("div");
    modal.className = "yths-modal";
    backdrop.append(modal);

    // Header
    const header = document.createElement("div");
    header.className = "yths-header";

    const titleWrap = document.createElement("div");
    titleWrap.className = "yths-title-wrap";
    const heading = document.createElement("h2");
    heading.className = "yths-title";
    heading.textContent = "Search Local Watch History";
    const countPill = document.createElement("span");
    countPill.className = "yths-count-pill";
    titleWrap.append(heading, countPill);

    const headerActions = document.createElement("div");
    headerActions.className = "yths-header-actions";
    const toolsToggleBtn = document.createElement("button");
    toolsToggleBtn.type = "button";
    toolsToggleBtn.className = "yths-btn";
    toolsToggleBtn.textContent = "Tools: Import / Backup / Accounts";

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "yths-btn";
    closeBtn.textContent = "Close";
    headerActions.append(toolsToggleBtn, closeBtn);
    header.append(titleWrap, headerActions);

    // Search & filter controls
    const searchArea = document.createElement("div");
    searchArea.className = "yths-search-area";

    const searchRow = document.createElement("div");
    searchRow.className = "yths-search-row";
    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.className = "yths-input yths-search-input";
    searchInput.placeholder = "Search title, channel, or description...";

    const strictLabel = document.createElement("label");
    strictLabel.className = "yths-filter-label";
    strictLabel.title = "Enforce exact literal AND matching";
    const strictCheck = document.createElement("input");
    strictCheck.type = "checkbox";
    const strictText = document.createElement("span");
    strictText.textContent = "Strict";
    strictLabel.append(strictCheck, strictText);

    const regexLabel = document.createElement("label");
    regexLabel.className = "yths-filter-label";
    const regexCheck = document.createElement("input");
    regexCheck.type = "checkbox";
    const regexText = document.createElement("span");
    regexText.textContent = "Regex";
    regexLabel.append(regexCheck, regexText);

    searchRow.append(searchInput, strictLabel, regexLabel);

    const hint = document.createElement("div");
    hint.className = "yths-hint";
    hint.textContent =
      'Broad search by default (stems, hyphen/space-insensitive, acronyms)  |  OR / |  "exact phrase"  -exclude  channel:name  account:label  type:short  after:YYYY-MM-DD  before:YYYY-MM-DD  /regex/i';

    const filtersRow = document.createElement("div");
    filtersRow.className = "yths-filters";

    const accountSelect = document.createElement("select");
    accountSelect.className = "yths-select";

    const typeSelect = document.createElement("select");
    typeSelect.className = "yths-select";
    const typeOptions: Array<[string, string]> = [
      ["", "All types"],
      ["video", "Video"],
      ["short", "Short"],
      ["live", "Live"],
      ["music", "Music"]
    ];
    for (const [val, label] of typeOptions) {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = label;
      typeSelect.append(opt);
    }

    const afterLabel = document.createElement("label");
    afterLabel.className = "yths-filter-label";
    const afterSpan = document.createElement("span");
    afterSpan.textContent = "After:";
    const afterInput = document.createElement("input");
    afterInput.type = "date";
    afterInput.className = "yths-input";
    afterLabel.append(afterSpan, afterInput);

    const beforeLabel = document.createElement("label");
    beforeLabel.className = "yths-filter-label";
    const beforeSpan = document.createElement("span");
    beforeSpan.textContent = "Before:";
    const beforeInput = document.createElement("input");
    beforeInput.type = "date";
    beforeInput.className = "yths-input";
    beforeLabel.append(beforeSpan, beforeInput);

    const sortSelect = document.createElement("select");
    sortSelect.className = "yths-select";
    const sortOptions: Array<[SortMode, string]> = [
      ["relevance", "Best match"],
      ["newest", "Most recent"],
      ["oldest", "Oldest"],
      ["most-watched", "Most watched"]
    ];
    for (const [val, label] of sortOptions) {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = label;
      sortSelect.append(opt);
    }

    const clearFiltersBtn = document.createElement("button");
    clearFiltersBtn.type = "button";
    clearFiltersBtn.className = "yths-btn";
    clearFiltersBtn.textContent = "Clear";

    filtersRow.append(accountSelect, typeSelect, afterLabel, beforeLabel, sortSelect, clearFiltersBtn);

    const errorBox = document.createElement("div");
    errorBox.className = "yths-error";
    errorBox.style.display = "none";

    searchArea.append(searchRow, hint, filtersRow, errorBox);

    // Collapsible Tools Drawer
    const toolsContainer = document.createElement("div");
    toolsContainer.className = "yths-tools";
    toolsContainer.style.display = "none";

    const tabsBar = document.createElement("div");
    tabsBar.className = "yths-tabs";
    const tabTakeoutBtn = document.createElement("button");
    tabTakeoutBtn.type = "button";
    tabTakeoutBtn.className = "yths-btn";
    tabTakeoutBtn.textContent = "Import Takeout";
    const tabBackupBtn = document.createElement("button");
    tabBackupBtn.type = "button";
    tabBackupBtn.className = "yths-btn";
    tabBackupBtn.textContent = "Backup / Restore";
    const tabAccountsBtn = document.createElement("button");
    tabAccountsBtn.type = "button";
    tabAccountsBtn.className = "yths-btn";
    tabAccountsBtn.textContent = "Accounts";
    tabsBar.append(tabTakeoutBtn, tabBackupBtn, tabAccountsBtn);

    const toolBody = document.createElement("div");
    toolBody.className = "yths-tool-panel";
    toolsContainer.append(tabsBar, toolBody);

    // Results list
    const resultsContainer = document.createElement("div");
    resultsContainer.className = "yths-results";

    modal.append(header, searchArea, toolsContainer, resultsContainer);

    const populateAccountDropdown = () => {
      const prevValue = accountSelect.value;
      accountSelect.replaceChildren();
      const allOpt = document.createElement("option");
      allOpt.value = "";
      allOpt.textContent = "All accounts";
      accountSelect.append(allOpt);

      for (const acc of library.listAccounts()) {
        const opt = document.createElement("option");
        opt.value = acc.accountId;
        opt.textContent = acc.label;
        accountSelect.append(opt);
      }
      if (prevValue) {
        accountSelect.value = prevValue;
      }
    };

    const renderResults = () => {
      const result = library.search(searchInput.value, {
        regex: regexCheck.checked,
        strict: strictCheck.checked,
        accountId: accountSelect.value || undefined,
        kind: (typeSelect.value as VideoKind) || undefined,
        afterDate: afterInput.value || undefined,
        beforeDate: beforeInput.value || undefined,
        sort: sortSelect.value as SortMode,
        limit: currentLimit
      });

      if (result.queryError) {
        errorBox.textContent = result.queryError;
        errorBox.style.display = "block";
      } else {
        errorBox.textContent = "";
        errorBox.style.display = "none";
      }

      countPill.textContent = `${result.totalMatches} ${result.totalMatches === 1 ? "match" : "matches"}`;
      resultsContainer.replaceChildren();

      if (result.items.length === 0) {
        const empty = document.createElement("div");
        empty.className = "yths-empty";
        empty.textContent =
          result.queryError
            ? "Fix the search query above."
            : "No matching watch history entries found.";
        resultsContainer.append(empty);
        return;
      }

      for (const item of result.items) {
        if (item.rowType === "collapsed") {
          resultsContainer.append(renderCollapsedRow(item));
        } else {
          resultsContainer.append(renderFlatRow(item));
        }
      }

      if (result.items.length < result.totalMatches) {
        const loadMoreBtn = document.createElement("button");
        loadMoreBtn.type = "button";
        loadMoreBtn.className = "yths-btn yths-load-more";
        loadMoreBtn.textContent = `Load more (${result.items.length} of ${result.totalMatches})`;
        loadMoreBtn.addEventListener("click", () => {
          currentLimit += PAGE_SIZE;
          renderResults();
        });
        resultsContainer.append(loadMoreBtn);
      }
    };

    const renderToolTab = () => {
      tabTakeoutBtn.className = `yths-btn ${activeToolTab === "takeout" ? "yths-tab-active" : ""}`;
      tabBackupBtn.className = `yths-btn ${activeToolTab === "backup" ? "yths-tab-active" : ""}`;
      tabAccountsBtn.className = `yths-btn ${activeToolTab === "accounts" ? "yths-tab-active" : ""}`;
      toolBody.replaceChildren();

      if (activeToolTab === "takeout") {
        const row1 = document.createElement("div");
        row1.className = "yths-tool-row";

        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = ".json,application/json";
        fileInput.className = "yths-input";

        const ownerSelect = document.createElement("select");
        ownerSelect.className = "yths-select";

        const activeAcc = getCurrentAccount();
        const known = library.listAccounts();
        const hasActive = known.some((a) => a.accountId === activeAcc.accountId);
        const optionsList = hasActive ? known : [activeAcc, ...known];
        for (const acc of optionsList) {
          const opt = document.createElement("option");
          opt.value = acc.accountId;
          opt.textContent =
            acc.accountId === activeAcc.accountId
              ? `${acc.label} (current session)`
              : acc.label;
          ownerSelect.append(opt);
        }
        if (!optionsList.some((a) => a.accountId === BLANK_ACCOUNT_ID)) {
          const blankOpt = document.createElement("option");
          blankOpt.value = BLANK_ACCOUNT_ID;
          blankOpt.textContent = BLANK_ACCOUNT_ID;
          ownerSelect.append(blankOpt);
        }
        const newAccOpt = document.createElement("option");
        newAccOpt.value = "__new__";
        newAccOpt.textContent = "+ New account label...";
        ownerSelect.append(newAccOpt);
        ownerSelect.value = activeAcc.accountId;

        const newLabelInput = document.createElement("input");
        newLabelInput.type = "text";
        newLabelInput.className = "yths-input";
        newLabelInput.placeholder = "New account label (e.g. Phone Personal)";
        newLabelInput.style.display = "none";

        ownerSelect.addEventListener("change", () => {
          newLabelInput.style.display = ownerSelect.value === "__new__" ? "inline-block" : "none";
        });

        const importBtn = document.createElement("button");
        importBtn.type = "button";
        importBtn.className = "yths-btn yths-btn-primary";
        importBtn.textContent = "Import Takeout JSON";

        const status = document.createElement("div");
        status.className = "yths-status";

        importBtn.addEventListener("click", () => {
          const file = fileInput.files?.[0];
          if (!file) {
            status.textContent = "Choose a watch-history.json file first.";
            return;
          }
          let targetAccountId = ownerSelect.value;
          let targetLabel: string | undefined;
          if (targetAccountId === "__new__") {
            const entered = newLabelInput.value.trim();
            if (!entered) {
              status.textContent = "Enter a label for the new account.";
              return;
            }
            targetAccountId = slugifyAccountId(entered);
            targetLabel = entered;
          } else {
            const matched = optionsList.find((a) => a.accountId === targetAccountId);
            targetLabel = matched?.label;
          }

          status.textContent = "Importing Takeout history...";
          void file
            .text()
            .then((raw) =>
              library.importTakeout(raw, {
                accountId: targetAccountId,
                accountLabel: targetLabel
              })
            )
            .then((summary) =>
              library.load().then(() => summary)
            )
            .then((summary) => {
              const totalStored = library.search("").totalMatches;
              status.textContent = `Processed ${summary.totalEntries}: imported ${summary.imported}, deduplicated ${summary.deduplicated}, skipped ads ${summary.skippedAds}, skipped removed ${summary.skippedRemoved}, skipped invalid ${summary.skippedInvalid}. Verified in storage: ${totalStored} total watches.`;
              populateAccountDropdown();
              renderResults();
            })
            .catch((err: unknown) => {
              status.textContent = `Import failed: ${err instanceof Error ? err.message : String(err)}`;
            });
        });

        row1.append(fileInput, ownerSelect, newLabelInput, importBtn);
        toolBody.append(row1, status);
        return;
      }

      if (activeToolTab === "backup") {
        const row1 = document.createElement("div");
        row1.className = "yths-tool-row";

        const exportBtn = document.createElement("button");
        exportBtn.type = "button";
        exportBtn.className = "yths-btn yths-btn-primary";
        exportBtn.textContent = "Export Backup JSON";

        const backupFileInput = document.createElement("input");
        backupFileInput.type = "file";
        backupFileInput.accept = ".json,application/json";
        backupFileInput.className = "yths-input";

        const restoreBtn = document.createElement("button");
        restoreBtn.type = "button";
        restoreBtn.className = "yths-btn";
        restoreBtn.textContent = "Import Backup JSON (Merge)";

        const status = document.createElement("div");
        status.className = "yths-status";

        exportBtn.addEventListener("click", () => {
          const snapshot = library.exportBackup();
          const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
            type: "application/json"
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          const d = new Date();
          const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          a.href = url;
          a.download = `youtube-history-backup-${stamp}.json`;
          document.body.append(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
          status.textContent = `Exported ${snapshot.watches.length} watches across ${snapshot.videos.length} videos.`;
        });

        restoreBtn.addEventListener("click", () => {
          const file = backupFileInput.files?.[0];
          if (!file) {
            status.textContent = "Choose a backup JSON file first.";
            return;
          }
          status.textContent = "Merging backup snapshot...";
          void file
            .text()
            .then((raw) => library.importBackup(raw))
            .then((summary) =>
              library.load().then(() => summary)
            )
            .then((summary) => {
              const totalStored = library.search("").totalMatches;
              status.textContent = `Merged backup: imported ${summary.importedWatches}, deduplicated ${summary.deduplicatedWatches}, videos merged ${summary.videosMerged}, accounts added ${summary.accountsMerged}. Verified in storage: ${totalStored} total watches.`;
              populateAccountDropdown();
              renderResults();
            })
            .catch((err: unknown) => {
              status.textContent = `Restore failed: ${err instanceof Error ? err.message : String(err)}`;
            });
        });

        row1.append(exportBtn, backupFileInput, restoreBtn);
        toolBody.append(row1, status);
        return;
      }

      // Accounts tab
      const accounts = library.listAccounts();
      if (accounts.length === 0) {
        const emptyAcc = document.createElement("div");
        emptyAcc.className = "yths-hint";
        emptyAcc.textContent = "No accounts recorded yet. Watch a video or import Takeout first.";
        toolBody.append(emptyAcc);
        return;
      }

      const status = document.createElement("div");
      status.className = "yths-status";

      for (const acc of accounts) {
        const row = document.createElement("div");
        row.className = "yths-tool-row";

        const idCode = document.createElement("code");
        idCode.textContent = acc.accountId;

        const labelInput = document.createElement("input");
        labelInput.type = "text";
        labelInput.className = "yths-input";
        labelInput.value = acc.label;

        const saveBtn = document.createElement("button");
        saveBtn.type = "button";
        saveBtn.className = "yths-btn";
        saveBtn.textContent = "Save";
        saveBtn.addEventListener("click", () => {
          void library.setAccountLabel(acc.accountId, labelInput.value).then((updated) => {
            labelInput.value = updated.label;
            status.textContent = `Saved label "${updated.label}" for ${updated.accountId}.`;
            populateAccountDropdown();
            renderResults();
          });
        });

        row.append(idCode, labelInput, saveBtn);
        toolBody.append(row);
      }
      toolBody.append(status);
    };

    const scheduleSearch = () => {
      if (debounceTimer !== null) {
        window.clearTimeout(debounceTimer);
      }
      debounceTimer = window.setTimeout(() => {
        currentLimit = PAGE_SIZE;
        renderResults();
      }, 120);
    };

    searchInput.addEventListener("input", scheduleSearch);
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        if (debounceTimer !== null) {
          window.clearTimeout(debounceTimer);
        }
        currentLimit = PAGE_SIZE;
        renderResults();
      }
    });

    for (const control of [
      strictCheck,
      regexCheck,
      accountSelect,
      typeSelect,
      afterInput,
      beforeInput,
      sortSelect
    ]) {
      control.addEventListener("change", () => {
        strictCheck.disabled = regexCheck.checked;
        currentLimit = PAGE_SIZE;
        renderResults();
      });
    }

    clearFiltersBtn.addEventListener("click", () => {
      searchInput.value = "";
      strictCheck.checked = false;
      strictCheck.disabled = false;
      regexCheck.checked = false;
      accountSelect.value = "";
      typeSelect.value = "";
      afterInput.value = "";
      beforeInput.value = "";
      sortSelect.value = "relevance";
      currentLimit = PAGE_SIZE;
      renderResults();
    });

    toolsToggleBtn.addEventListener("click", () => {
      toolsVisible = !toolsVisible;
      toolsContainer.style.display = toolsVisible ? "flex" : "none";
      if (toolsVisible) {
        renderToolTab();
      }
    });

    tabTakeoutBtn.addEventListener("click", () => {
      activeToolTab = "takeout";
      renderToolTab();
    });
    tabBackupBtn.addEventListener("click", () => {
      activeToolTab = "backup";
      renderToolTab();
    });
    tabAccountsBtn.addEventListener("click", () => {
      activeToolTab = "accounts";
      renderToolTab();
    });

    const closeModal = () => {
      window.removeEventListener("keydown", handleEsc);
      openRefreshFn = null;
      backdrop.remove();
    };

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeModal();
      }
    };

    closeBtn.addEventListener("click", closeModal);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) {
        closeModal();
      }
    });
    window.addEventListener("keydown", handleEsc);

    openRefreshFn = () => {
      populateAccountDropdown();
      renderResults();
      // A remote watch must not reset a selected import file or unsaved label.
      // Tool panels rebuild when the user opens or switches their tab.
    };

    document.body.append(backdrop);
    populateAccountDropdown();
    renderResults();
    searchInput.focus();

    void library.load().then(() => {
      if (!backdrop.isConnected) {
        return;
      }
      populateAccountDropdown();
      renderResults();
      if (toolsVisible) {
        renderToolTab();
      }
    });
  };

  const syncHistoryButton = () => {
    if (stopped) {
      return;
    }
    if (!isHistoryPage()) {
      removeHistoryBar();
      return;
    }

    ensureStylesInjected();

    const browse = document.querySelector<HTMLElement>('ytd-browse[page-subtype="history"]');
    const primary = browse?.querySelector<HTMLElement>("#primary") ?? null;
    let bar = document.getElementById(BAR_ID);

    if (!bar) {
      bar = document.createElement("div");
      bar.id = BAR_ID;

      const label = document.createElement("span");
      label.textContent = "Local History Index";

      const btn = document.createElement("button");
      btn.id = OPEN_BTN_ID;
      btn.type = "button";
      btn.textContent = "Search Local History";
      btn.addEventListener("click", openModal);

      bar.append(label, btn);
    }

    if (primary) {
      bar.classList.remove("yths-floating-fallback");
      if (bar.parentElement !== primary) {
        primary.prepend(bar);
      }
    } else if (document.body) {
      bar.classList.add("yths-floating-fallback");
      if (!bar.isConnected) {
        document.body.append(bar);
      }
    }
  };

  const observer = new MutationObserver(() => {
    if (isHistoryPage()) {
      const bar = document.getElementById(BAR_ID);
      const primary = document.querySelector('ytd-browse[page-subtype="history"] #primary');
      if (!bar || (primary && bar.parentElement !== primary)) {
        syncHistoryButton();
      }
    }
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.addEventListener("yt-navigate-finish", syncHistoryButton);
  window.addEventListener("popstate", syncHistoryButton);
  syncHistoryButton();

  return {
    refreshIfOpen() {
      openRefreshFn?.();
    },
    stop() {
      stopped = true;
      observer.disconnect();
      window.removeEventListener("yt-navigate-finish", syncHistoryButton);
      window.removeEventListener("popstate", syncHistoryButton);
      removeHistoryBar();
      document.getElementById(MODAL_ID)?.remove();
    }
  };
}
