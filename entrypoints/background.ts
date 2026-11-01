import { defineBackground } from 'wxt/utils/define-background';
import { clearLibrary, db, deletePreviews, deleteTabs, moveTabs, storePreview } from '../lib/db';
import { compressScreenshot } from '../lib/capture';
import {
  canRestore,
  domainOf,
  orderSessionTabs,
  type Job,
  type SavedTab,
  type Scope,
} from '../lib/model';
import { getSettings } from '../lib/settings';
import type { Request } from '../lib/api';
import { initToolbarCounter } from '../lib/toolbar';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export default defineBackground(() => {
  initToolbarCounter();
  let busy = false;
  let lastCapture = 0;
  let resuming: Promise<unknown> | undefined;
  type PendingCapture = {
    token: string;
    createdAt: number;
    scope: Scope;
    copy?: boolean;
    source: chrome.tabs.Tab[];
  };
  const ready = (async () => {
    const old = await db.jobs.get('current');
    if (old?.status === 'running') {
      await db.jobs.update('current', {
        status: 'interrupted',
        message:
          'The last operation was interrupted. Saved records were kept; check open tabs before trying again.',
        updatedAt: Date.now(),
      });
      await db.tabs.toCollection().modify((tab) => {
        if (tab.preview === 'pending') {
          tab.preview = 'failed';
          tab.captureError = 'The browser interrupted capture. Its saved URL is still available.';
        }
      });
    }
    await chrome.alarms.create('database-health', { periodInMinutes: 60 });
  })();

  async function updateJob(patch: Partial<Job>) {
    await db.jobs.update('current', { ...patch, updatedAt: Date.now() });
  }

  async function startJob(kind: Job['kind'], total: number) {
    await db.jobs.put({
      id: 'current',
      kind,
      status: 'running',
      message: kind === 'capture' ? 'Preparing your session…' : 'Opening saved tabs…',
      total,
      done: 0,
      failed: 0,
      updatedAt: Date.now(),
      issues: [],
    });
  }

  async function eligibleTabs(scope: Scope, windowId?: number) {
    const settings = await getSettings();
    const current =
      windowId ?? (await chrome.windows.getLastFocused({ windowTypes: ['normal'] })).id;
    const normalWindowIds = new Set(
      (await chrome.windows.getAll({ windowTypes: ['normal'] })).map((window) => window.id),
    );
    const query: chrome.tabs.QueryInfo = scope === 'all' ? {} : { windowId: current };
    if (scope === 'current') query.active = true;
    if (scope === 'selected') query.highlighted = true;
    return (await chrome.tabs.query(query))
      .filter(
        (tab) =>
          tab.id !== undefined &&
          normalWindowIds.has(tab.windowId) &&
          !tab.incognito &&
          typeof tab.url === 'string' &&
          /^(https?:|file:)/.test(tab.url) &&
          (settings.includePinned || !tab.pinned),
      )
      .sort((a, b) => a.windowId - b.windowId || a.index - b.index);
  }

  async function openManager() {
    const url = chrome.runtime.getURL('/manager.html');
    const existing = (await chrome.tabs.query({})).find((tab) => tab.url?.split('?')[0] === url);
    if (existing?.id) {
      await chrome.tabs.update(existing.id, { active: true });
      await chrome.windows.update(existing.windowId, { focused: true });
      return;
    }
    await chrome.tabs.create({ url });
  }

  async function capturePreview(
    source: chrome.tabs.Tab,
    saved: SavedTab,
    quality: 'balanced' | 'small' | 'high',
    captureSleepingTabs: boolean,
  ) {
    if (!source.id) throw new Error('The source tab is no longer available.');
    // Re-read immediately before activation: Memory Saver may have discarded a
    // previously loaded tab while earlier tabs were being captured.
    const before = await chrome.tabs.get(source.id);
    if (before.url !== saved.url || before.pendingUrl)
      throw new Error('The page changed while saving; the source tab was left open.');
    const sleeping = Boolean(before.discarded || before.frozen);
    if (sleeping && !captureSleepingTabs) {
      await db.tabs.update(saved.id, { preview: 'skipped', previewBytes: 0 });
      return false;
    }
    const waitMs = sleeping ? 15000 : 7000;
    const deadline = Date.now() + waitMs;
    await chrome.tabs.update(source.id, { active: true });
    await delay(650);
    while (true) {
      const current = await chrome.tabs.get(source.id);
      if (current.status !== 'loading' && !current.discarded && !current.frozen) break;
      if ((await db.jobs.get('current'))?.cancelRequested)
        throw new Error('Capture was cancelled while loading. The source tab was left open.');
      if (Date.now() >= deadline)
        throw new Error(
          `The ${sleeping ? 'sleeping tab' : 'tab'} did not finish loading within ${waitMs / 1000} seconds. The source tab was left open.`,
        );
      await delay(250);
    }
    const check = await chrome.tabs.get(source.id);
    if (check.url !== saved.url || check.pendingUrl)
      throw new Error('The page changed while saving; the source tab was left open.');
    const active = (await chrome.tabs.query({ active: true, windowId: source.windowId }))[0];
    if (active?.id !== source.id)
      throw new Error('The active tab changed during capture. Please try again.');
    await delay(Math.max(0, 600 - (Date.now() - lastCapture)));
    // captureVisibleTab targets a window, never an arbitrary background tab.
    const dataUrl = await chrome.tabs.captureVisibleTab(source.windowId, {
      format: 'jpeg',
      quality: 90,
    });
    lastCapture = Date.now();
    const after = (await chrome.tabs.query({ active: true, windowId: source.windowId }))[0];
    if (after?.id !== source.id || after.url !== saved.url || after.pendingUrl)
      throw new Error('The tab changed during capture; its preview was discarded.');
    const image = await compressScreenshot(dataUrl, quality);
    await storePreview(saved.id, image);
    return true;
  }

  async function runAside(message: Extract<Request, { type: 'ASIDE' }>, source: chrome.tabs.Tab[]) {
    let done = 0;
    let closed = 0;
    let skipped = 0;
    const issues: string[] = [];
    const sessionId = crypto.randomUUID();
    let activeTabs: chrome.tabs.Tab[] = [];
    const guardTabs = new Map<number, number>();
    const deferred: { source: chrome.tabs.Tab; saved: SavedTab }[] = [];
    let showManager = false;
    const closeSource = async (sourceTab: chrome.tabs.Tab, saved: SavedTab): Promise<boolean> => {
      const checkSource = async () => {
        const current = await chrome.tabs.get(sourceTab.id!);
        if (current.url !== saved.url || current.pendingUrl) {
          await db.tabs.update(saved.id, { closeState: 'changed' });
          throw new Error(
            'The page changed; its original URL is saved and the live tab was left open.',
          );
        }
        return current;
      };
      const current = await checkSource();
      if (!(await db.tabs.get(saved.id)))
        throw new Error('The saved record is missing. The source tab was left open.');
      const remaining = await chrome.tabs.query({ windowId: current.windowId });
      const others = remaining.filter((tab) => tab.id !== current.id);
      if (!others.length) {
        // Capture and commit the last source before creating its replacement.
        // Never remove that last source unless Chrome acknowledges the new tab.
        const blank = await chrome.tabs.create({
          url: 'about:blank',
          active: true,
          windowId: current.windowId,
        });
        if (blank.id === undefined)
          throw new Error(
            'Chrome could not create the final blank tab. The saved source was left open.',
          );
        guardTabs.set(current.windowId, blank.id);
        await checkSource();
      } else if (current.active) {
        // Use an existing awake tab so closing this one cannot wake a sleeping
        // neighbor. If none exists, finish the sleeping sources first.
        const next = others.find((tab) => !tab.discarded && !tab.frozen);
        if (!next?.id) return false;
        await chrome.tabs.update(next.id, { active: true });
        await checkSource();
      }
      await chrome.tabs.remove(sourceTab.id!);
      await db.tabs.update(saved.id, { closeState: 'closed' });
      closed++;
      return true;
    };
    try {
      const settings = await getSettings();
      showManager = settings.openManagerAfterSaving;
      const previews = settings.capturePreviews && !message.withoutPreviews;
      activeTabs = await chrome.tabs.query({ active: true });
      const now = Date.now();
      const records: SavedTab[] = [];
      for (const tab of source) {
        let group: SavedTab['group'];
        if (tab.groupId !== -1) {
          try {
            const original = await chrome.tabGroups.get(tab.groupId);
            group = {
              id: original.id,
              title: original.title || '',
              color: original.color,
              collapsed: original.collapsed,
            };
          } catch {
            /* The source group may have been removed. */
          }
        }
        records.push({
          id: crypto.randomUUID(),
          sessionId,
          url: tab.url!,
          title: tab.title || tab.url!,
          domain: domainOf(tab.url!),
          createdAt: now,
          index: tab.index,
          position: records.length,
          windowId: tab.windowId,
          sourceTabId: tab.id,
          pinned: tab.pinned,
          muted: Boolean(tab.mutedInfo?.muted),
          group,
          favorite: false,
          preview: previews ? 'pending' : 'disabled',
          closeState: 'open',
        });
      }
      // The entire URL inventory commits before screenshot work or tab closure.
      await db.transaction('rw', db.sessions, db.tabs, async () => {
        await db.sessions.add({
          id: sessionId,
          name: `Session · ${new Date(now).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`,
          createdAt: now,
          favorite: false,
        });
        await db.tabs.bulkAdd(records);
      });
      for (let i = 0; i < source.length; i++) {
        if ((await db.jobs.get('current'))?.cancelRequested) break;
        const tab = source[i];
        const saved = records[i];
        await updateJob({
          message: `${previews ? 'Capturing' : 'Saving'} ${i + 1} of ${source.length} · ${saved.domain}`,
          done,
        });
        try {
          if (previews) {
            if (!(await capturePreview(tab, saved, settings.quality, settings.captureSleepingTabs)))
              skipped++;
          }
          if (!message.copy && !(await closeSource(tab, saved)))
            deferred.push({ source: tab, saved });
        } catch (error) {
          const reason = errorMessage(error);
          issues.push(`${saved.title}: ${reason}`);
          const record = await db.tabs.get(saved.id);
          if (record?.preview === 'pending')
            await db.tabs.update(saved.id, { preview: 'failed', captureError: reason });
        }
        done++;
        await updateJob({ done, failed: issues.length, issues });
      }
      const cancelled = Boolean((await db.jobs.get('current'))?.cancelRequested);
      if (!cancelled) {
        for (const item of deferred) {
          try {
            if (!(await closeSource(item.source, item.saved)))
              throw new Error(
                'This saved source was left open to avoid waking remaining sleeping tabs.',
              );
          } catch (error) {
            issues.push(`${item.saved.title}: ${errorMessage(error)}`);
          }
        }
      }
      await db.tabs
        .where('sessionId')
        .equals(sessionId)
        .and((tab) => tab.preview === 'pending')
        .modify({
          preview: 'failed',
          captureError: 'Capture was cancelled. The source tab was left open.',
        });
      await updateJob({
        status: cancelled ? 'cancelled' : 'completed',
        done,
        failed: issues.length,
        issues,
        message:
          (message.copy
            ? `${source.length} tab records saved as a copy${issues.length ? ` · ${issues.length} preview issues` : ''}.`
            : `${closed} ${closed === 1 ? 'tab' : 'tabs'} saved and closed${source.length - closed ? ` · ${source.length - closed} left open` : ''}.`) +
          (skipped
            ? ` ${skipped} sleeping ${skipped === 1 ? 'tab' : 'tabs'} saved without previews.`
            : ''),
      });
    } catch (error) {
      await updateJob({
        status: 'interrupted',
        done,
        issues: [...issues, errorMessage(error)],
        message: `Saving stopped: ${errorMessage(error)}. Unsaved tabs were left open.`,
      });
    } finally {
      for (const tab of activeTabs) {
        if (tab.id) {
          try {
            await chrome.tabs.update(tab.id, { active: true });
          } catch {
            /* Closed tabs cannot regain focus. */
          }
        }
      }
      try {
        if (showManager) await openManager();
      } catch {
        /* Saved data remains accessible through the toolbar. */
      } finally {
        try {
          for (const [windowId, guardTabId] of guardTabs) {
            try {
              const remaining = await chrome.tabs.query({ windowId });
              const guard = remaining.find((tab) => tab.id === guardTabId);
              // A user may have navigated our blank tab while saving. Keep it.
              if (!guard || guard.url !== 'about:blank' || guard.pendingUrl) continue;
              if (remaining.length > 1) await chrome.tabs.remove(guardTabId);
              else await chrome.tabs.update(guardTabId, { active: true });
            } catch {
              /* Already closed. */
            }
          }
        } finally {
          busy = false;
        }
      }
    }
  }

  function resumePreparedCapture(token?: string): Promise<unknown> {
    if (resuming) return resuming;
    resuming = (async () => {
      await ready;
      const { pendingCapture } = await chrome.storage.session.get('pendingCapture');
      const pending = pendingCapture as PendingCapture | undefined;
      // The event and the still-open popup can both acknowledge one grant.
      if (!pending || (token && pending.token !== token)) return;
      if (Date.now() - pending.createdAt > 120000) {
        await chrome.storage.session.remove('pendingCapture');
        throw new Error('The save request expired. Please click Set tabs aside again.');
      }
      if (!(await chrome.permissions.contains({ origins: ['<all_urls>'] }))) return;
      if (busy) throw new Error('Another tab operation is already running.');
      busy = true;
      try {
        await chrome.storage.session.remove('pendingCapture');
        const source: chrome.tabs.Tab[] = [];
        for (const original of pending.source) {
          const current = await chrome.tabs.get(original.id!);
          if (
            current.url !== original.url ||
            current.pendingUrl ||
            current.windowId !== original.windowId
          ) {
            throw new Error(
              'A requested tab changed while granting access. Please try saving again.',
            );
          }
          source.push(current);
        }
        await startJob('capture', source.length);
        void runAside({ type: 'ASIDE', scope: pending.scope, copy: pending.copy }, source).catch(
          (error) => console.error('Capture operation could not report its result', error),
        );
      } catch (error) {
        busy = false;
        throw error;
      }
    })().finally(() => {
      resuming = undefined;
    });
    return resuming;
  }

  async function runRestore(message: Extract<Request, { type: 'RESTORE' }>) {
    let done = 0;
    const issues: string[] = [];
    let placeholderId: number | undefined;
    try {
      const records = (await db.tabs.bulkGet([...new Set(message.ids)])).filter(
        (tab): tab is SavedTab => Boolean(tab),
      );
      const restoreOrder = [...new Set(records.map((tab) => tab.sessionId))].flatMap((id) =>
        orderSessionTabs(records.filter((tab) => tab.sessionId === id)),
      );
      await updateJob({ total: records.length });
      if (!records.length) {
        await updateJob({
          status: 'completed',
          message: 'These saved tabs have already been removed.',
        });
        return;
      }
      let windowId = (await chrome.windows.getLastFocused({ windowTypes: ['normal'] })).id;
      if (message.newWindow) {
        const window = await chrome.windows.create({ url: 'about:blank', focused: true });
        if (!window?.id)
          throw new Error('Chrome could not create a restore window. Saved tabs were kept.');
        windowId = window.id;
        placeholderId = window.tabs?.[0]?.id;
      }
      const groups = new Map<string, number>();
      for (const tab of restoreOrder) {
        if ((await db.jobs.get('current'))?.cancelRequested) break;
        let created: chrome.tabs.Tab | undefined;
        try {
          if (!canRestore(tab.url))
            throw new Error('This address cannot be safely opened by the extension.');
          created = await chrome.tabs.create({
            url: tab.url,
            windowId,
            active: false,
            pinned: tab.pinned,
          });
          // Store browser acknowledgement before deleting anything. A site load is not required.
          if (!created.id) throw new Error('Chrome did not acknowledge the new tab.');
          if (tab.muted) {
            try {
              await chrome.tabs.update(created.id, { muted: true });
            } catch {
              /* Opening succeeded. */
            }
          }
          if (tab.group && !tab.pinned) {
            try {
              const key = `${tab.sessionId}:${tab.windowId}:${tab.group.id}`;
              let groupId = groups.get(key);
              groupId = await chrome.tabs.group({
                tabIds: created.id,
                ...(groupId === undefined ? {} : { groupId }),
              });
              groups.set(key, groupId);
              await chrome.tabGroups.update(groupId, {
                title: tab.group.title,
                color: tab.group.color,
                collapsed: tab.group.collapsed,
              });
            } catch (error) {
              // The tab is already open: report grouping separately without opening it twice.
              issues.push(
                `${tab.title}: Opened, but its group could not be restored. ${errorMessage(error)}`,
              );
            }
          }
          if (message.remove) await deleteTabs([tab.id]);
          done++;
          if (placeholderId) {
            try {
              await chrome.tabs.remove(placeholderId);
            } catch {
              /* Already closed. */
            }
            placeholderId = undefined;
          }
        } catch (error) {
          issues.push(
            `${tab.title}: ${created?.id ? 'Opened, but the saved copy could not be removed. ' : ''}${errorMessage(error)}`,
          );
        }
        await updateJob({
          done,
          failed: issues.length,
          issues,
          message: `Opened ${done} of ${records.length} tabs…`,
        });
        await delay(80);
      }
      const cancelled = Boolean((await db.jobs.get('current'))?.cancelRequested);
      await updateJob({
        status: cancelled ? 'cancelled' : 'completed',
        done,
        failed: issues.length,
        issues,
        message: `${done} ${done === 1 ? 'tab' : 'tabs'} restored${message.remove ? ' and removed from saved tabs' : ' · saved copies kept'}${issues.length ? ` · ${issues.length} need attention` : ''}.`,
      });
    } catch (error) {
      await updateJob({
        status: 'interrupted',
        message: `Restore stopped: ${errorMessage(error)}. Check open tabs before retrying.`,
        issues: [...issues, errorMessage(error)],
      });
    } finally {
      busy = false;
    }
  }

  async function handle(message: Request) {
    await ready;
    if (message.type === 'COUNT')
      return { count: (await eligibleTabs(message.scope, message.windowId)).length };
    if (message.type === 'MANAGER') return openManager();
    if (message.type === 'CANCEL')
      return updateJob({ cancelRequested: true, message: 'Stopping after the current tab…' });
    if (message.type === 'RESUME_ASIDE') return resumePreparedCapture(message.token);
    if (message.type === 'DISCARD_ASIDE') {
      const { pendingCapture } = await chrome.storage.session.get('pendingCapture');
      if ((pendingCapture as PendingCapture | undefined)?.token === message.token)
        await chrome.storage.session.remove('pendingCapture');
      return;
    }
    if (busy)
      throw new Error(
        'Another tab operation is running. Wait for it to finish or cancel it first.',
      );
    if (message.type === 'OPEN') {
      busy = true;
      try {
        const saved = await db.tabs.get(message.id);
        if (!saved) throw new Error('This saved tab is no longer available.');
        if (!canRestore(saved.url)) throw new Error('This address cannot be safely opened.');
        const window = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
        const opened = await chrome.tabs.create({
          url: saved.url,
          windowId: window.id,
          active: true,
        });
        if (opened.id === undefined) throw new Error('Chrome could not open this tab.');
        return { tabId: opened.id };
      } finally {
        busy = false;
      }
    }
    if (message.type === 'PREPARE_ASIDE') {
      const source = await eligibleTabs(message.scope);
      if (!source.length) throw new Error('No eligible tabs to save.');
      const pendingCapture: PendingCapture = {
        token: crypto.randomUUID(),
        createdAt: Date.now(),
        scope: message.scope,
        copy: message.copy,
        source,
      };
      await chrome.storage.session.set({ pendingCapture });
      return { token: pendingCapture.token };
    }
    if (message.type === 'ASIDE') {
      busy = true;
      try {
        const settings = await getSettings();
        if (
          settings.capturePreviews &&
          !message.withoutPreviews &&
          !(await chrome.permissions.contains({ origins: ['<all_urls>'] }))
        )
          throw new Error('Enable screenshot access, or choose “Save without previews”.');
        const source = await eligibleTabs(message.scope, message.windowId);
        if (!source.length)
          throw new Error(
            'No eligible tabs. Internal pages, incognito tabs, and excluded pinned tabs are not included.',
          );
        await startJob('capture', source.length);
        void runAside(message, source).catch((error) =>
          console.error('Capture operation could not report its result', error),
        );
        return { count: source.length };
      } catch (error) {
        busy = false;
        throw error;
      }
    }
    if (message.type === 'RESTORE') {
      busy = true;
      try {
        await startJob('restore', message.ids.length);
        void runRestore(message).catch((error) =>
          console.error('Restore operation could not report its result', error),
        );
      } catch (error) {
        busy = false;
        throw error;
      }
      return;
    }
    // Lock destructive database mutations against captures and concurrent restores.
    busy = true;
    try {
      if (message.type === 'DELETE') return await deleteTabs(message.ids);
      if (message.type === 'MOVE')
        return {
          moved: await moveTabs(message.ids, message.destinationId, db, message.beforeId),
        };
      if (message.type === 'CLEAR') return await clearLibrary();
      if (message.type === 'DELETE_PREVIEWS') return await deletePreviews();
      throw new Error('Unknown extension request.');
    } finally {
      busy = false;
    }
  }

  chrome.runtime.onMessage.addListener((message: Request, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    void handle(message)
      .then((data) => respond({ ok: true, data }))
      .catch((error) => respond({ ok: false, error: errorMessage(error) }));
    return true;
  });
  chrome.permissions.onAdded.addListener(() => {
    void resumePreparedCapture().catch((error) =>
      console.error('Permission-approved capture could not start', error),
    );
  });
  chrome.commands.onCommand.addListener((command) => {
    void (
      command === 'open-manager' ? openManager() : handle({ type: 'ASIDE', scope: 'window' })
    ).catch(async (error) => {
      if (!busy)
        await db.jobs.put({
          id: 'current',
          kind: 'capture',
          status: 'interrupted',
          total: 0,
          done: 0,
          failed: 1,
          issues: [errorMessage(error)],
          message: errorMessage(error),
          updatedAt: Date.now(),
        });
      await openManager();
    });
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== 'database-health') return;
    void ready.then(async () => {
      if (busy) return;
      // Defensive cleanup for old/incomplete records, never deletes saved URLs.
      await db.transaction('rw', db.tabs, db.screenshots, async () => {
        const validIds = new Set(await db.tabs.toCollection().primaryKeys());
        const orphans = (await db.screenshots.toCollection().primaryKeys()).filter(
          (id) => !validIds.has(id),
        );
        await db.screenshots.bulkDelete(orphans);
      });
    });
  });
});
