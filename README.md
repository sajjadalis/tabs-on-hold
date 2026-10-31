# Tabs Aside Done Right

A local-first Chrome extension for setting tabs aside with screenshots of their visible webpage area. Built with React, TypeScript, WXT, and IndexedDB (Dexie).

## Try version 0.1.6

The production extension is in **`.output/chrome-mv3`** after building.

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this project's `.output/chrome-mv3` folder.
4. Pin **Tabs Aside Done Right** to the toolbar.
5. Open a few ordinary websites, click the extension, and choose **Set N tabs aside**.
6. Grant optional website access when Chrome asks. This allows fresh previews of multiple tabs.

After saving, captured tabs close and an emptied source window closes. The manager does not open automatically by default. Enable **Open manager after saving** in Settings to change this. Excluded tabs, new tabs outside the capture request, and failed captures remain open. The popup has a saved-library button. For URL-only saving, use **Save without previews**, or disable screenshot capture in Settings.

On first use, a pending save is handed to the background worker before Chrome opens its permission prompt. Granting screenshot access resumes that same request even if Chrome closes the popup. The request expires after two minutes and only includes the original tabs; changed pages are left open.

The manager uses a compact title/search row, an inline remove-after-restore toggle, and readable 14 px controls. Each preview offers separate **Preview** and **Restore** actions; the full-preview dialog also supports restoration. Successful operations show a floating result instead of taking up gallery space. Successful results disappear five seconds after completion and do not reappear on refresh. Running operations and results with errors remain visible until completion or manual dismissal. Hiding a result does not delete its operation record or any saved tabs.

Session and tab **⋯** menus close when clicking outside, moving keyboard focus outside, pressing **Escape**, or selecting an action. Escape returns focus to the menu trigger.

Dark mode uses neutral zinc backgrounds, surfaces, borders, and controls. A **sun/moon toggle next to Preferences in the top header** switches directly between dark and light and saves the choice. The manager and toolbar popup share this preference. **Preferences → Appearance → Match system** remains available; the header toggle switches from the currently resolved system mode to an explicit light/dark choice.

Card screenshots use a responsive **16:9 frame** so tabs saved on different monitors still align. **Fill card** is the default: images scale proportionally and crop at the edges to fill the frame. Settings → **Card screenshots → Fit whole image** shows the entire image with letterboxing when needed. Opening **Preview** always displays the complete stored image; neither display mode modifies screenshot data. The gallery avoids variable image heights, which would make mixed-monitor rows uneven.

Move saved tabs between existing sessions in either of two ways:

- In **Sessions** view, drag a card (or its grip) onto another session, including a collapsed session header. Dragging a selected card moves all selected tabs together.
- Open a tab’s **⋯ → Move to session…** menu, or select several tabs and use **Move to session…** in the selection toolbar. The destination picker supports keyboard navigation and works from Sessions, All tabs, and Favorites.

Moves append tabs in their existing relative order and preserve their URLs, titles, capture dates, favorites, groups, and screenshot IDs. They do not open, close, or recapture browser tabs. A source session is deleted automatically if moving its last tab empties it; a nonempty source stays. Dropping onto the current session is a no-op. Tab moves, destination ordering, and empty-session cleanup commit in one database transaction. Moving never copies or deletes screenshot blobs. Existing libraries keep their original order until a move assigns a session position; no database reset is needed.

**The two existing JSON exports are preserved, unchanged, in `temp/imports/`. They are not imported, bundled, or uploaded.** Import support is a later task.

## Included

- Current-window, selected-tabs, current-tab, and all-normal-windows capture scopes.
- Fresh, compressed WebP viewport previews of loaded tabs, enabled by default.
- Sleeping/discarded/frozen tabs are saved without waking them and show a placeholder by default. Optional **Capture previews for sleeping tabs** loads them for screenshots, with a 15-second load limit per tab.
- Three image quality presets, preserving the complete captured aspect ratio.
- Save a copy without closing source tabs.
- Pinned tabs excluded by default; incognito and internal pages excluded.
- Most-recent-first sessions, session renaming, and collapsible sections.
- Session, all-tabs, and favorites views.
- Card/list layouts and full-preview dialog.
- Search across titles, URLs, domains, and session names.
- Website, preview-availability, and saved-date filters.
- Newest/oldest, title, website, and stable random sorting with reshuffle.
- Individual, session, and selected-tab restoration.
- Drag-and-drop and menu-based single/bulk moves between sessions, with automatic empty-session cleanup.
- Restore into a new window from the session menu.
- A visible **Remove saved items after restoring** toggle, enabled by default.
- Restore original order, pinned/muted state, and groups where supported.
- Permanent tab/session deletion, preview-only deletion, and clear-library controls.
- Local image storage usage, light/dark/system themes, and URL-only backup export.
- Persistent operation progress, cancellation, and interrupted-operation reporting.

## What saving guarantees

The URL inventory is committed to IndexedDB before any tab closes. With screenshots enabled, loaded tabs close only after their compressed images are committed. By default, sleeping tabs intentionally skip capture: their saved URL commits before closing, and their cards show a placeholder. A failed screenshot or load timeout leaves the source open and retains the saved URL with an explanation.

Chrome captures the active tab in a window. Fresh capture activates eligible tabs sequentially, waits briefly for rendering, checks that the active tab and URL still match, and respects capture rate limits. Pages can change when activated; these are best-effort snapshots at capture time, not simultaneous snapshots at button-press time.

Cancelling stops after the current tab. Unfinished source tabs stay open. Their already-saved URL records remain in the session. Closing the popup does not cancel a job.

If Chrome interrupts the service worker, the next startup marks the job interrupted and preserves saved records. Operations are not automatically repeated: check open tabs before retrying an interrupted restore.

## Storage and deletion

Sessions and searchable tab metadata are separate from binary screenshot blobs in IndexedDB. Small preferences use `chrome.storage.local`. There are no accounts, remote image services, telemetry, or cloud uploads.

Each saved tab owns one screenshot. Deleting tabs removes their images in the same database transaction and removes sessions once empty. Deleting all previews retains URLs and sessions. Deleting the library clears sessions, tabs, images, and operation records. An hourly maintenance task removes orphaned images defensively.

Manual deletion asks for confirmation and then deletes immediately. There is **no trash or Undo archive** in this version. Restore-and-remove deletes a record and its image only after Chrome acknowledges opening that tab. Failed restores stay saved. If a tab opens but deleting its saved copy fails, the operation reports that distinction.

`unlimitedStorage` avoids normal extension storage quota/eviction restrictions; disk failures still need handling. Storage usage shown in the app is the sum of encoded image sizes, not the browser's exact database allocation. Database engines may reuse freed pages before the underlying disk files shrink. Application deletion is not a promise of forensic secure erasure, and does not delete independently exported backups.

Preview images load only near the viewport, temporary object URLs are revoked, and large collections are shown in batches (12 initially per session, 60 in the all-tabs view).

## Limits to know

- Restoring opens URLs. It does not restore page history, unsaved forms, authentication, scroll position, fullscreen mode, or playback position.
- Sleeping tabs get placeholders without being activated by default. Enable **Capture previews for sleeping tabs** to load them one at a time. This can take longer and use more memory/network data; a 15-second load timeout leaves that source tab open with a saved URL and a failed-preview placeholder.
- Protected video, browser policies, and particular page/window states may prevent useful screenshots. A successful screenshot call can still contain a black or incomplete video region.
- Local file previews also require Chrome's **Allow access to file URLs** extension setting.
- Multiple source windows are represented in the saved order; restoring into one target window does not recreate the original multi-window geometry.
- URL backup export excludes images. Import of these backups and the two historical exports is not implemented yet.
- Uninstalling the extension removes its local database. Export important URLs first.

## Development

Node.js 22.12+ is recommended.

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run zip
```

`npm.cmd` avoids PowerShell execution-policy restrictions on `npm.ps1`. NPM's cache is kept inside the project in `.cache/npm`.

### Real browser smoke test

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) '.cache\playwright'
npx.cmd playwright install chromium
npm.cmd run build
npm.cmd run test:browser
```

The smoke test launches an isolated Chromium profile in `.cache`, opens local fixture websites (including a playing video), captures actual screenshots, checks image formats and video pixels, tests library interactions, restores with and without removal, checks partial failures, and verifies complete deletion. It also exercises a 1,000-tab metadata collection. It never opens or modifies your normal browser profile or imports your existing JSON files.

For unattended capture tests only, the script copies the built extension into `.cache` and grants website access in that throwaway copy's manifest. The production manifest keeps website access optional. Screenshots of the interface are written to `artifacts/`.

### Shortcuts

- `Alt+Shift+A`: set current-window tabs aside (grant screenshot access through the popup first).
- `Alt+Shift+S`: open the manager.
- `/`: focus search in the manager.

Customize browser shortcuts at `chrome://extensions/shortcuts`.
