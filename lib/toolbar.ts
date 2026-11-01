const badgeColor = '#486b3d';

export function initToolbarCounter() {
  const revisions = new Map<number, number>();
  let nextRevision = 0;

  async function refreshWindow(windowId: number) {
    const revision = ++nextRevision;
    revisions.set(windowId, revision);
    try {
      const tabs = await chrome.tabs.query({ windowId });
      if (revisions.get(windowId) !== revision) return;
      const count = tabs.length;
      const text = count > 999 ? '999+' : String(count);
      const title = `Tabs on Hold · ${count} ${count === 1 ? 'tab' : 'tabs'} in this window`;
      // Chrome actions are scoped to tabs, so every tab gets its own window's count.
      await Promise.allSettled(
        tabs.flatMap((tab) =>
          tab.id === undefined
            ? []
            : [
                chrome.action.setBadgeText({ tabId: tab.id, text }),
                chrome.action.setTitle({ tabId: tab.id, title }),
              ],
        ),
      );
    } catch {
      // A window can close while its tab events are still arriving.
    } finally {
      if (revisions.get(windowId) === revision) revisions.delete(windowId);
    }
  }

  const refresh = (windowId: number) => void refreshWindow(windowId);
  chrome.tabs.onCreated.addListener((tab) => refresh(tab.windowId));
  chrome.tabs.onRemoved.addListener((_tabId, info) => {
    if (!info.isWindowClosing) refresh(info.windowId);
  });
  chrome.tabs.onAttached.addListener((_tabId, info) => refresh(info.newWindowId));
  chrome.tabs.onDetached.addListener((_tabId, info) => refresh(info.oldWindowId));
  chrome.tabs.onReplaced.addListener((tabId) => {
    void chrome.tabs
      .get(tabId)
      .then((tab) => refresh(tab.windowId))
      .catch(() => {});
  });
  // Covers navigation (which resets per-tab action state) and switching tabs/windows.
  chrome.tabs.onActivated.addListener((info) => refresh(info.windowId));
  chrome.tabs.onUpdated.addListener((_tabId, change, tab) => {
    if (change.status === 'loading') refresh(tab.windowId);
  });

  void chrome.action.setBadgeBackgroundColor({ color: badgeColor }).catch(() => {});
  void chrome.action.setBadgeTextColor({ color: '#ffffff' }).catch(() => {});
  // Runs on installation, browser startup, and every service-worker restart.
  void chrome.tabs
    .query({})
    .then((tabs) => {
      for (const windowId of new Set(tabs.map((tab) => tab.windowId))) refresh(windowId);
    })
    .catch(() => {});
}
