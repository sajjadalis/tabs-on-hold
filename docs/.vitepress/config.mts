import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitepress';
import { APP_VERSION } from '../../lib/version';

const base = '/';
const repository = 'https://github.com/sajjadalis/tabs-on-hold';
const description = 'Save and organize tabs with screenshot previews and easy restore.';

export default defineConfig({
  title: 'Tabs on Hold',
  description,
  lang: 'en-US',
  base,
  cleanUrls: true,
  sitemap: { hostname: 'https://tabsonhold.intentdeep.com' },
  outDir: fileURLToPath(new URL('../../.output/docs', import.meta.url)),
  cacheDir: fileURLToPath(new URL('../../.cache/vitepress', import.meta.url)),
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}logo.svg` }],
    ['meta', { name: 'theme-color', content: '#486b3d' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Tabs on Hold' }],
    ['meta', { property: 'og:description', content: description }],
    ['style', {}, `:root { --tabs-on-hold-version: ${JSON.stringify(`v${APP_VERSION}`)}; }`],
  ],
  themeConfig: {
    logo: '/logo.svg',
    search: { provider: 'local' },
    nav: [
      { text: 'Guide', link: '/guide' },
      { text: 'Backups', link: '/backups' },
      { text: 'Privacy', link: '/privacy' },
      { text: 'Support', link: '/support' },
    ],
    sidebar: [
      {
        text: 'Using Tabs on Hold',
        items: [
          { text: 'Get started', link: '/guide' },
          { text: 'Backups & imports', link: '/backups' },
          { text: 'Help & common questions', link: '/support' },
          { text: 'Privacy & permissions', link: '/privacy' },
        ],
      },
      {
        text: 'For contributors',
        collapsed: true,
        items: [
          { text: 'Development', link: '/development' },
          { text: 'Backup format', link: '/backup-format' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: repository }],
    outline: { level: [2, 3] },
    footer: {
      message: `Released under the <a href="${repository}/blob/main/LICENSE">MIT License</a>. · <a href="${base}privacy">Privacy</a> · <a href="${base}support">Support</a>`,
      copyright: 'Copyright © 2026 Sajjad Ali',
    },
  },
});
