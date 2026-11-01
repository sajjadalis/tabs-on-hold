# Native JSON backup format, version 1

The native format is the primary portable backup contract for Tabs on Hold. Migration adapters translate other extensions' exports into the same session/tab model. IndexedDB's schema version is independent of this file format version.

## Envelope

| Field                 | Value                                       |
| --------------------- | ------------------------------------------- |
| `format`              | `"tabs-on-hold"`                            |
| `version`             | `1` (number)                                |
| `exportedAt`          | UTC ISO 8601 string                         |
| `includesScreenshots` | `false`                                     |
| `sessions`            | Array of session records                    |
| `tabs`                | Array of tab records, linked by `sessionId` |

Unknown native versions are rejected. Optional future fields may be added without changing version 1; incompatible required structure changes require a new version and an explicit migration adapter.

## Sessions

Each record contains a unique string `id`, `name`, `createdAt` (Unix milliseconds), and boolean `favorite`. An unnamed imported session receives a date-based name. Invalid or missing session dates use the import date and produce a warning.

## Tabs

Each record contains a unique string `id`, the owning `sessionId`, `title`, `url`, `createdAt` (Unix milliseconds), `index`, optional `position`, `windowId`, and boolean `pinned`, `muted`, and `favorite`.

`position` preserves the current order within a session. For older records without positions, ordering falls back to original window ID, index, and tab ID. `windowId` is an ordering/grouping key from the source browser, not a target window to open on import or restore. Domain labels are derived from the URL on import.

Optional `group` metadata contains `id`, `title`, `color`, and boolean `collapsed`. Supported Chrome colors are grey, blue, red, yellow, green, pink, purple, cyan, and orange. A group's saved identity is scoped by session and source window. Chrome assigns new live IDs during restoration. Unrecognized colors fall back to grey with a warning.

Supported restore URL schemes are HTTP, HTTPS, file, and chrome, matching the extension's restore policy. Missing, malformed, and unsupported addresses are skipped with a count in the import preview. Chrome policies may still prevent a particular supported address from opening. Duplicate URLs are preserved.

## State intentionally excluded

Backups contain no screenshot blobs, screenshot availability/status/size, capture errors, source live tab IDs, close state, jobs, preferences, analytics identifiers, or import history. Existing version 1 exports that included temporary database fields remain importable; those fields are ignored. Every imported tab receives a new internal ID, closed source state, and disabled preview state. Importing never visits URLs or changes browser tabs.

## Import behavior

Users select sessions before adding them to the existing library. New internal session/tab IDs prevent collisions with existing records, including IDs in a native backup. Orphaned tab references, duplicate native IDs, malformed structure, unknown formats/versions, excessive nesting, and files containing no supported tabs are rejected before any database write.

Limits are 25 MB per file, 10,000 sessions, and 100,000 tab entries. Empty sessions are shown but cannot be selected. Import writes and an import receipt commit atomically; errors roll back the entire selection. Receipts record a SHA-256 fingerprint of the parsed source JSON plus selected source session keys. Whitespace changes do not bypass detection. Different exports with changed content have different fingerprints; no URL-based deduplication is applied. A checkbox explicitly permits repeat imports. Clearing the library removes receipts too.

Images can be captured after restoring and setting tabs aside again. A future complete backup can package this manifest and image files in a ZIP archive; it is not part of version 1 JSON backups.
