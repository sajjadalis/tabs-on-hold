# Backups & imports

Export a backup when you want a separate copy of your library, especially before uninstalling the extension.

## Export your library

1. Open the saved library.
2. Choose **Export a backup** in the sidebar, just below **Import sessions**.
3. Save the downloaded JSON file somewhere you can find it again.

You can also use **Settings → Export a backup**.

The file includes your sessions, saved URLs, tab details, and available screenshot previews. It does not include preferences or operation history.

Screenshot bytes are embedded in the backup. You do not need to reopen websites to recover those previews.

## Import a backup

1. Choose **Import sessions** in the saved library.
2. Select a supported JSON backup file.
3. Review the sessions and select the ones to add.
4. Confirm the import.

Imports add to your current library. Sessions already imported from the same file are flagged; you can explicitly choose to import them again. Duplicate website URLs can represent different saved tabs and are preserved.

Tabs Aside and Tab Session Manager exports are also supported. Screenshot previews are available only when the backup contains supported image data.

## File limits

Backups can be up to **256 MB**, with a maximum of **16 MB per screenshot**. Invalid files or screenshot data are rejected before they are added to the library.

## Keep backup files private

Backups can contain private URLs, page titles, and screenshots. Screenshot data uses Base64 encoding, which is **not encryption**. Store and share backups with the same care as the pages they contain.

The extension does not upload exported backups. Deleting the extension’s saved data does not delete files you downloaded separately.

## Before you uninstall

Uninstalling removes the extension’s local library. Export first if you want to keep your sessions, then import that file after reinstalling.

For the technical file specification, see [Native JSON backup format](backup-format.md).
