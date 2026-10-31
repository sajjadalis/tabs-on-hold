import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Tabs Aside Done Right',
    short_name: 'Tabs Aside',
    description:
      'Clear your tabs. Keep your place. A private, visual tab manager with local screenshot previews.',
    minimum_chrome_version: '116',
    permissions: ['tabs', 'tabGroups', 'storage', 'unlimitedStorage', 'alarms'],
    optional_host_permissions: ['<all_urls>'],
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    action: { default_title: 'Tabs Aside Done Right' },
    commands: {
      'set-aside': {
        suggested_key: { default: 'Alt+Shift+A' },
        description: 'Set eligible tabs in the current window aside',
      },
      'open-manager': {
        suggested_key: { default: 'Alt+Shift+S' },
        description: 'Open your saved sessions',
      },
    },
  },
});
