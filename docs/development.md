# Development

## Setup

Use Node.js 22.12 or later.

```sh
npm ci
npm run dev
```

Load the extension from the output folder printed by WXT at `chrome://extensions` with Developer mode enabled.

On Windows, use `npm.cmd` and `npx.cmd` if PowerShell blocks the `.ps1` wrappers.

## Checks

```sh
npm run typecheck
npm test
npm run build
```

Unit tests cover capture and restore operations, storage transactions, search, imports, and backup images.

For browser tests, install Chromium into the project's browser cache:

```sh
PLAYWRIGHT_BROWSERS_PATH=.cache/playwright npx playwright install chromium
npm run build
npm run test:browser
```

In PowerShell:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) '.cache/playwright'
npx.cmd playwright install chromium
npm.cmd run build
npm.cmd run test:browser
```

Browser tests use an isolated profile and synthetic data. They exercise capture, restore, session organization, screenshot backup round trips, and a 1,000-tab library. UI screenshots are written to `artifacts/`.

## Build and package

```sh
npm run build
npm run zip
```

The unpacked extension is written to `.output/chrome-mv3`; the ZIP package is written under `.output`.

The release version comes from `package.json`. The interface and generated manifest use that value.

## Project layout

| Path           | Purpose                                                    |
| -------------- | ---------------------------------------------------------- |
| `entrypoints/` | Background worker and extension pages                      |
| `lib/`         | Storage, browser operations, settings, and backup handling |
| `ui/`          | React components and styles                                |
| `public/`      | Bundled icons and images                                   |
| `tests/`       | Unit tests                                                 |
| `scripts/`     | Browser tests and icon generation                          |

Run `npm run format` to format source files. Regenerate toolbar icons with `node scripts/icons.mjs`.
