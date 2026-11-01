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

## Documentation website

The VitePress site lives in `docs/`. Install its dependencies with the same root `npm ci` command used for the extension.

```sh
npm run docs:dev
npm run docs:build
npm run docs:preview
```

Development uses `http://127.0.0.1:4175/tabs-on-hold/`; production preview uses `http://localhost:4176/tabs-on-hold/`. The production build is written to `.output/docs` and its cache to `.cache/vitepress`. The build checks internal Markdown links.

The homepage uses a 40-second rainbow accent cycle inspired by Foldergram. Documentation pages keep the sage accent. The animation stops when the browser requests reduced motion. Website version labels use `lib/version.ts`, which reads `package.json`.

### GitHub Pages

The `Documentation` workflow builds documentation on pull requests and deploys pushes to `main` or manual runs. In the repository’s **Settings → Pages**, select **GitHub Actions** as the build source before the first deployment.

The site uses `/tabs-on-hold/` as its base path. After deployment, its homepage is `https://sajjadalis.github.io/tabs-on-hold/` and its privacy page is `https://sajjadalis.github.io/tabs-on-hold/privacy`. Use the deployed privacy URL in the Chrome Web Store dashboard.

The homepage and README share `docs/public/images/tabs-on-hold-promo.png`. Keep public images free of personal tabs and data. Website assets belong under `docs/public/` so they are not bundled with the extension.

The illustrated guide uses release screenshots from `docs/public/screenshots/`, captured with real public websites in an isolated browser profile. Use screenshots only beside the workflows they demonstrate.
