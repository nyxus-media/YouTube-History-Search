# YouTube History Search

> [!WARNING]
> This project is entirely vibe coded with no QC done. Use at your own risk.

A local, multi-account YouTube watch-history indexer and search overlay for Firefox + FireMonkey.

## Features

- **Live watch tracking**: Logs videos after 25 seconds of active visible playback (or 80% of duration with a 3-second floor for clips under 25 seconds), coalescing repeats of the same `(accountId, videoId)` within 30 minutes.
- **Cross-tab history**: Serializes saves across ordinary YouTube tabs and refreshes open search results after another tab saves.
- **Multi-account support**: Distinguishes Google logins, Brand Accounts, and signed-out (`blank`) sessions with editable friendly labels.
- **Google Takeout backfill**: Imports `watch-history.json`, tags Shorts/Live/YouTube Music, drops Google Ads entries and linkless removals, and assigns the chosen account owner.
- **Fast search on `/feed/history`**: Broad search by default (match-any with Best-match ranking, light stemming, word-start matching, space/hyphen-insensitive phrases, multiword initialisms, and `OR` / `|` with parentheses), plus a **Strict** toggle for exact literal `AND`, `"exact phrases"`, `-negation`, inline `/regex/i` or regex mode, `channel:`, `account:`, `type:`, inclusive local-timezone `after:YYYY-MM-DD` / `before:YYYY-MM-DD`, and `Best match` / `Most recent` / `Oldest` / collapsed `Most watched` sort modes.
- **Backup & merge restore**: Exports a portable `Backup Snapshot` JSON and safely merges backups back into existing history.

## Development & Build

```bash
npm install
npm run typecheck
npm test
npm run build
```

`npm run build` outputs `dist/youtube-history-search.user.js`.

## Installing & Updating in FireMonkey (Firefox)

1. Run `npm run build` to generate `dist/youtube-history-search.user.js`.
2. **First-time install:** Open FireMonkey's Options/Dashboard in Firefox, click **New UserScript** (or import the `.user.js` file), paste the contents of `dist/youtube-history-search.user.js`, and save.
3. **Updating without losing saved history:** Export a **Backup JSON** inside the modal first as a safeguard. Then **refresh the FireMonkey Options/Dashboard tab**, open the **existing** script in FireMonkey's editor, paste the updated contents of `dist/youtube-history-search.user.js`, and click **Save**. Do **not** use FireMonkey's "Import" file action to replace an existing script (which can replace or orphan its per-script storage) and do not save from a stale FireMonkey editor tab opened before your Takeout import.
4. Verify in FireMonkey's script list that the script is enabled and shows `@match https://www.youtube.com/*` and grants `GM.getValue`, `GM.setValue`, `GM.deleteValue`, `GM.getValues`, `GM.setValues`, `GM.addValueChangeListener`, `GM.removeValueChangeListener`, and `unsafeWindow`.

After updating, reload **every open YouTube tab** so no older script instance can continue writing without the cross-tab lock.

Cross-tab coordination uses the browser's Web Locks API and FireMonkey's storage change listeners. Firefox 115+ (the build target) supports Web Locks. The lock covers ordinary tabs on `https://www.youtube.com` within the same browser storage partition; it does **not** coordinate across Firefox containers or private/regular browsing boundaries. Avoid simultaneous writes across those boundaries. History remains in FireMonkey storage; no history is placed in page storage. If Web Locks are unavailable, initialization fails instead of silently allowing unsafe writes.

## Exporting Google Takeout History (`watch-history.json`)

1. Open [Google Takeout](https://takeout.google.com/) and click **Deselect all**.
2. Check **YouTube and YouTube Music**.
3. Open **All YouTube data included**, deselect everything except **history**.
4. Open **Multiple formats**, change **history** from HTML to **JSON**, and create/download the export.
5. Unzip the archive and locate `YouTube and YouTube Music/history/watch-history.json`.

## Manual Firefox Smoke-Test Checklist

1. Navigate to `https://www.youtube.com/feed/history` and verify the **Search Local History** button appears (and disappears when navigating to other YouTube pages).
2. Open **Search Local History** -> **Tools** -> **Import Takeout**, select the owning account (or create a new label), and import `watch-history.json`.
3. Test broad search (`bots "group iron man" programming`), the **Strict** and **Regex** checkboxes, `"quoted phrase"`, `OR` / `|`, `-negation`, `channel:`, `account:`, `type:short`, `after:`/`before:`, **Best match**, and **Most watched** (expanding watch dates).
4. Watch a video for >= 25 seconds (and a < 25s Short for >= 80%), return to `/feed/history`, and verify the live watch appears with duration and description snippet.
5. Export a backup JSON under **Tools** -> **Backup / Restore**, then test merging it back in.

### Cross-tab smoke test (Firefox + FireMonkey)

1. Update the existing script and reload all YouTube tabs. Keep Search Local History open in tab A with filters cleared.
2. In tab B, play a video visibly for at least 30 seconds. Return to A: the new watch should appear without closing the modal, and its current search/filter/sort selections should remain intact.
3. In two separate visible Firefox windows in the same container, play different videos long enough to record near the same time. Reload the history page and confirm both watches remain.
4. Repeat while importing a Takeout or backup file in another tab; confirm imported and live watches both survive.
5. Leave a file selected in Import Takeout (or edit an account label without saving), then record another watch elsewhere. The pending tool input should remain intact.

Automated tests simulate independent tabs, GM storage/listeners, and the Web Locks scheduler. The smoke test above is still required to verify the installed FireMonkey/Firefox integration.
