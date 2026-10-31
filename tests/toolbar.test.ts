import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initToolbarCounter } from '../lib/toolbar';

const event = () => {
  let listener: (...args: any[]) => void;
  return {
    addListener: vi.fn((callback) => {
      listener = callback;
    }),
    fire: (...args: any[]) => listener(...args),
  };
};
let tabs: { id: number; windowId: number; pinned?: boolean; url?: string }[];
let browser: any;

beforeEach(() => {
  tabs = [
    { id: 1, windowId: 10 },
    { id: 2, windowId: 10 },
    { id: 3, windowId: 20 },
  ];
  browser = {
    action: {
      setBadgeText: vi.fn().mockResolvedValue(undefined),
      setTitle: vi.fn().mockResolvedValue(undefined),
      setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
      setBadgeTextColor: vi.fn().mockResolvedValue(undefined),
    },
    tabs: {
      query: vi.fn(async ({ windowId }) =>
        tabs.filter((tab) => windowId === undefined || tab.windowId === windowId),
      ),
      get: vi.fn(async (id) => tabs.find((tab) => tab.id === id)),
      onCreated: event(),
      onRemoved: event(),
      onAttached: event(),
      onDetached: event(),
      onReplaced: event(),
      onActivated: event(),
      onUpdated: event(),
    },
  };
  vi.stubGlobal('chrome', browser);
});
afterEach(() => vi.unstubAllGlobals());
const expectBadge = async (tabId: number, text: string) => {
  await vi.waitFor(() => expect(browser.action.setBadgeText).toHaveBeenCalledWith({ tabId, text }));
};
async function start() {
  initToolbarCounter();
  await expectBadge(3, '1');
  vi.clearAllMocks();
}

describe('toolbar window counter', () => {
  it('initializes every window independently, including pinned and internal tabs', async () => {
    tabs[1] = { ...tabs[1], pinned: true, url: 'chrome://extensions' };
    initToolbarCounter();
    await expectBadge(1, '2');
    await expectBadge(2, '2');
    await expectBadge(3, '1');
    expect(browser.action.setTitle).toHaveBeenCalledWith({
      tabId: 3,
      title: 'Tabs Aside · 1 tab in this window',
    });
    expect(browser.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#486b3d' });
    expect(browser.action.setBadgeTextColor).toHaveBeenCalledWith({ color: '#ffffff' });
  });
  it('updates remaining and new tabs when tabs open and close', async () => {
    await start();
    const added = { id: 4, windowId: 10 };
    tabs.push(added);
    browser.tabs.onCreated.fire(added);
    await expectBadge(4, '3');
    tabs = tabs.filter((tab) => tab.id !== 2);
    browser.tabs.onRemoved.fire(2, { windowId: 10, isWindowClosing: false });
    await expectBadge(1, '2');
    await expectBadge(4, '2');
    expect(browser.action.setBadgeText).not.toHaveBeenCalledWith({ tabId: 3, text: '2' });
  });
  it('updates both windows after moving a tab', async () => {
    await start();
    tabs[1].windowId = 20;
    browser.tabs.onDetached.fire(2, { oldWindowId: 10 });
    browser.tabs.onAttached.fire(2, { newWindowId: 20 });
    await expectBadge(1, '1');
    await expectBadge(2, '2');
    await expectBadge(3, '2');
  });
  it('refreshes replaced, activated, and navigating tabs', async () => {
    await start();
    tabs[0].id = 4;
    browser.tabs.onReplaced.fire(4, 1);
    await expectBadge(4, '2');
    browser.action.setBadgeText.mockClear();
    browser.tabs.onActivated.fire({ tabId: 4, windowId: 10 });
    await expectBadge(4, '2');
    browser.action.setBadgeText.mockClear();
    browser.tabs.onUpdated.fire(4, { status: 'loading' }, tabs[0]);
    await expectBadge(4, '2');
  });
  it('keeps large badges compact while giving the exact count in the tooltip', async () => {
    tabs = Array.from({ length: 1001 }, (_, id) => ({ id, windowId: 10 }));
    initToolbarCounter();
    await expectBadge(0, '999+');
    expect(browser.action.setTitle).toHaveBeenCalledWith({
      tabId: 0,
      title: 'Tabs Aside · 1001 tabs in this window',
    });
  });
  it('ignores stale queries even after a newer refresh has finished', async () => {
    await start();
    let resolveOld: (value: typeof tabs) => void;
    browser.tabs.query.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    browser.tabs.onActivated.fire({ windowId: 10 });
    tabs.push({ id: 4, windowId: 10 });
    browser.tabs.onCreated.fire(tabs[3]);
    await expectBadge(1, '3');
    browser.action.setBadgeText.mockClear();
    resolveOld!(tabs.slice(0, 2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(browser.action.setBadgeText).not.toHaveBeenCalled();
  });
  it('tolerates tabs or windows disappearing during an update', async () => {
    await start();
    browser.action.setBadgeText.mockRejectedValue(new Error('Tab closed'));
    browser.tabs.onActivated.fire({ windowId: 10 });
    await vi.waitFor(() => expect(browser.action.setBadgeText).toHaveBeenCalled());
    browser.tabs.query.mockRejectedValueOnce(new Error('Window closed'));
    browser.tabs.onDetached.fire(2, { oldWindowId: 10 });
    browser.tabs.onRemoved.fire(1, { windowId: 10, isWindowClosing: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
