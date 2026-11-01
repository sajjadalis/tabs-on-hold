# Privacy & permissions

This page explains what Tabs on Hold stores and how that data is used.

## Stored data

The extension stores saved URLs, titles, session details, screenshot previews, and tab metadata such as favorites and groups. It also stores preferences, operation status, and import history.

Saved tabs and screenshots are kept in the extension's local IndexedDB database. Preferences use Chrome's local extension storage. The extension does not collect usage analytics or upload your saved library.

Capturing previews can activate or load source websites. Restoring tabs opens those websites normally, with their usual network requests and privacy policies.

## Permissions

| Permission                | Purpose                                           |
| ------------------------- | ------------------------------------------------- |
| `tabs`                    | Read tab details and manage saved/restored tabs   |
| `tabGroups`               | Save and restore tab groups                       |
| `storage`                 | Store preferences and pending capture requests    |
| `unlimitedStorage`        | Store large libraries and screenshot previews     |
| `alarms`                  | Schedule database maintenance                     |
| `favicon`                 | Display website icons from Chrome's favicon cache |
| Website access (optional) | Capture screenshot previews across tabs           |

You can save tabs without screenshots without granting website access. Internal pages and incognito tabs are excluded from capture.

## Backups and deletion

Exported JSON backups include saved URLs and available screenshots. They are downloaded to a location you choose and are not uploaded by the extension.

Deleting saved tabs also deletes their screenshot previews. **Delete previews, keep tabs** removes images while retaining the saved URLs. **Delete all saved data** clears the library, operation status, and import history; preferences remain.

When **Remove after restoring** is enabled, successfully restored tabs and their previews are deleted from the saved library. Failed restores remain saved.

Uninstalling removes local extension data. Exported backup files remain wherever you saved them.

## Documentation website

The documentation website is configured for GitHub Pages hosting. When you visit a GitHub Pages site, GitHub logs your IP address for security purposes. See [GitHub’s privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement) for details.

The website does not access your extension’s saved tabs or screenshots. It does not include analytics or advertising scripts.

## Questions

For questions about this policy, [open an issue on GitHub](https://github.com/sajjadalis/tabs-on-hold/issues). Do not include private URLs, screenshots, or backup files in public issues.
