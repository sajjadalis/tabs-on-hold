# Help & common questions

## Why are some tabs still open after saving?

Tabs close only after their data is saved. Failed captures leave source tabs open so you can try again. Check the operation result in the library for details.

Internal Chrome pages and incognito tabs are excluded. Pinned tabs are excluded unless enabled in Settings.

## Why is a preview missing?

You may have saved without previews or without granting optional website access. Protected pages and video may not capture correctly.

Sleeping tabs are saved without waking them by default. Enable **Capture previews for sleeping tabs** in Settings to load those pages for a screenshot.

File previews also require Chrome’s **Allow access to file URLs** setting for the extension.

## Will restoring remove the saved copy?

**Remove after restoring** is enabled by default. Turn it off to keep a saved copy. **Open without removing** also keeps the saved tab. Failed restores remain saved.

## Does a preview reopen the website?

Opening an available screenshot preview displays the saved image. Restoring or opening a tab loads the website normally. If no screenshot is available, the default tab click action opens the page instead.

## Where is my library stored?

Saved tabs and screenshots are stored on your computer in the extension’s local storage. The extension does not upload your saved library. See [Privacy & permissions](privacy.md) for details.

## What happens when I delete saved data?

Deleting a saved tab also deletes its preview. **Delete previews, keep tabs** removes images while retaining saved URLs. **Delete all saved data** clears the library, operation status, and import history; preferences remain.

Deletion is permanent. Uninstalling also removes local extension data. Export a [backup](backups.md) before deleting anything you want to keep.

## How do I report a problem?

[Open an issue on GitHub](https://github.com/sajjadalis/tabs-on-hold/issues). Include your Chrome version, what you tried, what you expected, and what happened.

Review screenshots before attaching them. Do not post private URLs or backup files in public issues.
