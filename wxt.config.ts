import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Tabs on Hold',
    short_name: 'Tabs on Hold',
    description: 'Save and organize tabs with screenshot previews and easy restore.',
    minimum_chrome_version: '116',
    permissions: ['tabs', 'tabGroups', 'storage', 'unlimitedStorage', 'alarms', 'favicon'],
    optional_host_permissions: ['<all_urls>'],
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    action: {
      default_title: 'Tabs on Hold',
      default_icon: { 16: 'icon/16.png', 24: 'icon/24.png', 32: 'icon/32.png' },
    },
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
