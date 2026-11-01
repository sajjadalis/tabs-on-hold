# Native JSON backup format

Tabs on Hold exports sessions, saved tabs, and screenshots in one JSON file. Import adapters translate other extensions' exports into the same session/tab model.

## Envelope

| Field                 | Value                                           |
| --------------------- | ----------------------------------------------- |
| `format`              | `"tabs-on-hold"`                                |
| `version`             | `2` (number)                                    |
| `exportedAt`          | UTC ISO 8601 string                             |
| `includesScreenshots` | `true` when at least one screenshot is included |
| `sessions`            | Array of session records                        |
| `tabs`                | Array of tab records, linked by `sessionId`     |

## Sessions

Each record contains a unique string `id`, `name`, `createdAt` (Unix milliseconds), and boolean `favorite`. An unnamed imported session receives a date-based name. Invalid or missing session dates use the import date and produce a warning.

## Tabs

Each record contains a unique string `id`, the owning `sessionId`, `title`, `url`, `createdAt` (Unix milliseconds), `index`, optional `position`, `windowId`, and boolean `pinned`, `muted`, and `favorite`.

`position` preserves the current order within a session. If absent, ordering falls back to original window ID, index, and tab ID. `windowId` is an ordering/grouping key from the source browser, not a target window to open on import or restore. Domain labels are derived from the URL on import.

Optional `group` metadata contains `id`, `title`, `color`, and boolean `collapsed`. Supported Chrome colors are grey, blue, red, yellow, green, pink, purple, cyan, and orange. A group's saved identity is scoped by session and source window. Chrome assigns new live IDs during restoration. Unrecognized colors fall back to grey with a warning.

Supported restore URL schemes are HTTP, HTTPS, file, and chrome, matching the extension's restore policy. Missing, malformed, and unsupported addresses are skipped with a count in the import preview. Chrome policies may still prevent a particular supported address from opening. Duplicate URLs are preserved.

## State intentionally excluded

Backups contain the saved library, excluding preferences, operation status, import history, and live browser tab IDs. Each imported tab receives a new ID and a ready preview when a screenshot is included. Importing does not open websites.

## Embedded screenshots

Each tab may include a `screenshot` object alongside its URL:

```json
{
  "mimeType": "image/webp",
  "data": "BASE64_ENCODED_IMAGE_BYTES",
  "width": 1280,
  "height": 720,
  "capturedAt": 1793491200000
}
```

`data` is standard padded Base64 without a data-URL prefix. PNG, JPEG, and WebP are supported. Export preserves the original compressed image bytes without re-encoding or recapturing. Tabs without a stored screenshot omit the object. `includesScreenshots` is informational; individual screenshot records determine which previews are restored.

Import validates Base64, the image MIME type and file signature, dimensions from the image headers (up to 32,768 per side and 64 million pixels), a valid capture timestamp, and a decoded size no larger than 16 MB. The image must decode successfully, and its actual dimensions must match the backup metadata. Invalid screenshot records reject the file before any writes. Decoded binary blobs are stored separately in IndexedDB with the newly generated tab IDs; the Base64 strings are not stored in tab records. Byte counts are calculated from the decoded images.

## Import behavior

Users select sessions before adding them to the existing library. New internal session/tab IDs prevent collisions with existing records, including IDs in a native backup. Orphaned tab references, duplicate native IDs, malformed structure, unknown formats/versions, excessive nesting, and files containing no supported tabs are rejected before any database write.

Limits are 256 MB per JSON file, 10,000 sessions, and 100,000 tab entries. Empty sessions are shown but cannot be selected. Only screenshots belonging to selected sessions are saved. Sessions, tabs, screenshots, and the import receipt commit atomically; errors roll back the entire selection. Receipts record a SHA-256 fingerprint of the parsed source JSON plus selected source session keys. Whitespace changes do not bypass detection. Different exports with changed content have different fingerprints; no URL-based deduplication is applied. A checkbox explicitly permits repeat imports. Clearing the library removes receipts too.

Base64 adds roughly 33% to image size. The file-size limit applies to the complete JSON file, including encoded images. Import reads the file into memory.
