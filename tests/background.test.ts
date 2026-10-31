import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLibrary, db, storePreview } from '../lib/db';
import { DEFAULT_SETTINGS, type Job, type SavedTab } from '../lib/model';
import type { Request } from '../lib/api';

const compress = vi.hoisted(() => vi.fn());
const settings = vi.hoisted(() => vi.fn());
vi.mock('wxt/utils/define-background', () => ({ defineBackground: (main: () => void) => main }));
vi.mock('../lib/capture', () => ({ compressScreenshot: compress }));
vi.mock('../lib/settings', () => ({ getSettings: settings }));
import background from '../entrypoints/background';

let listener: (
  message: Request,
  sender: chrome.runtime.MessageSender,
  respond: (response: any) => void,
) => void;
let browserTabs: Map<number, chrome.tabs.Tab>;
let browser: any;
let nextId: number;
let permissionAdded: () => void;
let sessionStorage: Record<string, unknown>;
const tab = (id: number, url = `https://example.com/${id}`): chrome.tabs.Tab => ({
  id,
  url,
  title: `Tab ${id}`,
  active: true,
  index: id,
  windowId: 1,
  pinned: false,
  incognito: false,
  highlighted: true,
  selected: true,
  discarded: false,
  frozen: false,
  autoDiscardable: true,
  groupId: -1,
  status: 'complete',
});
const send = (message: Request) =>
  new Promise<any>((resolve) => listener(message, { id: 'test-extension' }, resolve));
async function settled(): Promise<Job> {
  await vi.waitFor(
    async () => {
      expect((await db.jobs.get('current'))?.status).not.toBe('running');
      expect([...browserTabs.values()].some((tab) => tab.url === 'about:blank')).toBe(false);
    },
    { timeout: 5000, interval: 20 },
  );
  return (await db.jobs.get('current'))!;
}
async function seedSaved() {
  await db.sessions.put({ id: 's', name: 'Saved', createdAt: 1, favorite: false });
  const records: SavedTab[] = [1, 2].map((id) => ({
    id: `saved-${id}`,
    sessionId: 's',
    url: `https://example.com/${id}`,
    title: `Saved ${id}`,
    domain: 'example.com',
    createdAt: 1,
    index: id,
    windowId: 1,
    pinned: false,
    muted: false,
    favorite: false,
    preview: 'ready',
    closeState: 'closed',
  }));
  await db.tabs.bulkPut(records);
  for (const record of records)
    await storePreview(record.id, {
      blob: new Blob(['image']),
      bytes: 5,
      width: 100,
      height: 80,
      capturedAt: 1,
    });
}

beforeEach(async () => {
  await clearLibrary();
  nextId = 100;
  browserTabs = new Map([[1, tab(1)]]);
  sessionStorage = {};
  settings.mockResolvedValue({ ...DEFAULT_SETTINGS });
  compress.mockReset().mockResolvedValue({
    blob: new Blob(['webp'], { type: 'image/webp' }),
    bytes: 4,
    width: 1280,
    height: 720,
    capturedAt: 1,
  });
  browser = {
    runtime: {
      id: 'test-extension',
      getURL: (file: string) => `chrome-extension://test-extension${file}`,
      onMessage: {
        addListener: vi.fn((callback: typeof listener) => {
          listener = callback;
        }),
      },
    },
    permissions: {
      contains: vi.fn().mockResolvedValue(true),
      onAdded: {
        addListener: vi.fn((callback) => {
          permissionAdded = callback;
        }),
      },
    },
    storage: {
      session: {
        get: vi.fn(async (key: string) => ({ [key]: structuredClone(sessionStorage[key]) })),
        set: vi.fn(async (value: Record<string, unknown>) => {
          Object.assign(sessionStorage, structuredClone(value));
        }),
        remove: vi.fn(async (key: string) => {
          delete sessionStorage[key];
        }),
      },
    },
    alarms: { create: vi.fn().mockResolvedValue(undefined), onAlarm: { addListener: vi.fn() } },
    commands: { onCommand: { addListener: vi.fn() } },
    windows: {
      getLastFocused: vi.fn().mockResolvedValue({ id: 1 }),
      getAll: vi.fn().mockResolvedValue([{ id: 1 }]),
      update: vi.fn().mockResolvedValue({ id: 1 }),
      create: vi.fn().mockResolvedValue({ id: 2, tabs: [] }),
    },
    tabGroups: { get: vi.fn(), update: vi.fn() },
    tabs: {
      query: vi.fn(async (query: chrome.tabs.QueryInfo) =>
        [...browserTabs.values()]
          .filter(
            (tab) =>
              (query.windowId === undefined || tab.windowId === query.windowId) &&
              (!query.active || tab.active) &&
              (!query.highlighted || tab.highlighted),
          )
          .map((tab) => ({ ...tab })),
      ),
      get: vi.fn(async (id: number) => {
        const record = browserTabs.get(id);
        if (!record) throw new Error('No tab');
        return { ...record };
      }),
      update: vi.fn(async (id: number, patch: Partial<chrome.tabs.Tab>) => {
        const record = browserTabs.get(id);
        if (!record) throw new Error('No tab');
        if (patch.active) for (const tab of browserTabs.values()) tab.active = false;
        Object.assign(record, patch);
        return record;
      }),
      remove: vi.fn(async (id: number) => {
        browserTabs.delete(id);
      }),
      create: vi.fn(async (properties: chrome.tabs.CreateProperties) => {
        const record = { ...tab(nextId++), ...properties };
        browserTabs.set(record.id!, record);
        return record;
      }),
      captureVisibleTab: vi.fn().mockResolvedValue('data:image/jpeg;base64,fixture'),
      group: vi.fn(),
    },
  };
  vi.stubGlobal('chrome', browser);
  (background as unknown as () => void)();
  await send({ type: 'COUNT', scope: 'window' });
});
afterEach(async () => {
  await settled().catch(() => {});
  vi.unstubAllGlobals();
});

describe('save-before-close and failure recovery', () => {
  it('commits the URL and compressed image before it closes the source tab', async () => {
    browser.tabs.remove.mockImplementation(async (id: number) => {
      const record = (await db.tabs.toArray()).find((tab) => tab.sourceTabId === id);
      if (id === 1) {
        expect(record?.preview).toBe('ready');
        expect(await db.screenshots.get(record!.id)).toBeDefined();
      } else {
        expect((await db.jobs.get('current'))?.status).toBe('completed');
      }
      browserTabs.delete(id);
    });
    expect((await send({ type: 'ASIDE', scope: 'window' })).ok).toBe(true);
    expect((await settled()).failed).toBe(0);
    expect(browser.tabs.remove).toHaveBeenCalledWith(1);
    expect((await db.tabs.toArray())[0].closeState).toBe('closed');
  });
  it('retains the source and its saved URL if screenshot capture fails', async () => {
    browser.tabs.captureVisibleTab.mockRejectedValue(new Error('capture denied'));
    await send({ type: 'ASIDE', scope: 'window' });
    const job = await settled();
    expect(job.failed).toBe(1);
    expect(browserTabs.has(1)).toBe(true);
    expect(browser.tabs.remove).not.toHaveBeenCalledWith(1);
    expect((await db.tabs.toArray())[0].preview).toBe('failed');
    expect(await db.screenshots.count()).toBe(0);
  });
  it('rolls back the URL inventory and leaves source tabs open if the database write fails', async () => {
    const reject = () => {
      throw new Error('disk full');
    };
    db.tabs.hook('creating', reject);
    try {
      await send({ type: 'ASIDE', scope: 'window' });
      expect((await settled()).status).toBe('interrupted');
      expect(await db.tabs.count()).toBe(0);
      expect(await db.sessions.count()).toBe(0);
      expect(browser.tabs.remove).not.toHaveBeenCalledWith(1);
      expect(browser.tabs.captureVisibleTab).not.toHaveBeenCalled();
    } finally {
      db.tabs.hook('creating').unsubscribe(reject);
    }
  });
  it('discards a potentially wrong screenshot and leaves a navigating source open', async () => {
    browser.tabs.captureVisibleTab.mockImplementation(async () => {
      browserTabs.get(1)!.url = 'https://example.com/changed';
      return 'data:image/jpeg;base64,fixture';
    });
    await send({ type: 'ASIDE', scope: 'window' });
    expect((await settled()).failed).toBe(1);
    expect(browser.tabs.remove).not.toHaveBeenCalledWith(1);
    expect(await db.screenshots.count()).toBe(0);
    expect((await db.tabs.toArray())[0].url).toBe('https://example.com/1');
  });
  it('rejects permanent deletion while a capture is running', async () => {
    await send({ type: 'ASIDE', scope: 'window' });
    const response = await send({ type: 'CLEAR' });
    expect(response.ok).toBe(false);
    expect(response.error).toContain('running');
    const moving = await send({ type: 'MOVE', ids: [], destinationId: 'missing' });
    expect(moving.ok).toBe(false);
    expect(moving.error).toContain('running');
    await settled();
    expect(await db.tabs.count()).toBe(1);
    expect(await db.screenshots.count()).toBe(1);
  });
  it('saves without previews when capture is disabled, even without host permission', async () => {
    settings.mockResolvedValue({ ...DEFAULT_SETTINGS, capturePreviews: false });
    browser.permissions.contains.mockResolvedValue(false);
    await send({ type: 'ASIDE', scope: 'window' });
    expect((await settled()).done).toBe(1);
    expect(browser.tabs.captureVisibleTab).not.toHaveBeenCalled();
    expect(browser.tabs.remove).toHaveBeenCalledWith(1);
    expect((await db.tabs.toArray())[0].preview).toBe('disabled');
  });
  it('removes only acknowledged restores and their images when some tabs fail to open', async () => {
    await seedSaved();
    const create = browser.tabs.create.getMockImplementation();
    browser.tabs.create.mockImplementation(async (properties: chrome.tabs.CreateProperties) => {
      if (properties.url?.endsWith('/2')) throw new Error('cannot open');
      return create(properties);
    });
    await send({ type: 'RESTORE', ids: ['saved-1', 'saved-2'], remove: true, newWindow: false });
    const job = await settled();
    expect(job.done).toBe(1);
    expect(job.failed).toBe(1);
    expect(await db.tabs.get('saved-1')).toBeUndefined();
    expect(await db.screenshots.get('saved-1')).toBeUndefined();
    expect(await db.tabs.get('saved-2')).toBeDefined();
    expect(await db.screenshots.get('saved-2')).toBeDefined();
    expect(await db.sessions.get('s')).toBeDefined();
  });
  it('refuses fresh screenshot capture before host permission is granted', async () => {
    browser.permissions.contains.mockResolvedValue(false);
    const response = await send({ type: 'ASIDE', scope: 'window' });
    expect(response.ok).toBe(false);
    expect(await db.tabs.count()).toBe(0);
    expect(browser.tabs.remove).not.toHaveBeenCalledWith(1);
  });
  it('stops on cancellation while retaining saved URL records and open source tabs', async () => {
    await send({ type: 'ASIDE', scope: 'window' });
    await send({ type: 'CANCEL' });
    expect((await settled()).status).toBe('cancelled');
    expect(await db.tabs.count()).toBe(1);
    expect(browser.tabs.remove).not.toHaveBeenCalledWith(1);
    expect((await db.tabs.toArray())[0].preview).toBe('failed');
  });
  it('marks unfinished captures as interrupted after a worker restart, preserving their URLs', async () => {
    await seedSaved();
    await db.tabs.update('saved-1', { preview: 'pending' });
    await db.jobs.put({
      id: 'current',
      kind: 'capture',
      status: 'running',
      message: 'Capturing…',
      total: 2,
      done: 0,
      failed: 0,
      updatedAt: 1,
      issues: [],
    });
    (background as unknown as () => void)();
    await send({ type: 'COUNT', scope: 'window' });
    expect((await db.jobs.get('current'))?.status).toBe('interrupted');
    expect((await db.tabs.get('saved-1'))?.preview).toBe('failed');
    expect((await db.tabs.get('saved-1'))?.url).toBe('https://example.com/1');
    expect(browser.tabs.remove).not.toHaveBeenCalled();
  });
  it('treats a group recreation failure separately from an already acknowledged restore', async () => {
    await seedSaved();
    await db.tabs.update('saved-1', {
      group: { id: 1, title: 'Work', color: 'green', collapsed: false },
    });
    browser.tabs.group.mockRejectedValue(new Error('cannot create group'));
    await send({ type: 'RESTORE', ids: ['saved-1'], remove: true, newWindow: false });
    expect((await settled()).done).toBe(1);
    expect(browser.tabs.create).toHaveBeenCalledTimes(1);
    expect(await db.tabs.get('saved-1')).toBeUndefined();
    expect(await db.screenshots.get('saved-1')).toBeUndefined();
  });
  it('restores moved tabs in their session positions rather than their original window order', async () => {
    await seedSaved();
    await db.tabs.update('saved-1', { windowId: 1, position: 1 });
    await db.tabs.update('saved-2', { windowId: 200, position: 0 });
    await send({ type: 'RESTORE', ids: ['saved-1', 'saved-2'], remove: false, newWindow: false });
    await settled();
    expect(
      browser.tabs.create.mock.calls.map(([args]: [chrome.tabs.CreateProperties]) => args.url),
    ).toEqual(['https://example.com/2', 'https://example.com/1']);
  });
  it('continues a prepared save from the permission event with no popup continuation', async () => {
    browser.permissions.contains.mockResolvedValue(false);
    const prepared = await send({ type: 'PREPARE_ASIDE', scope: 'window' });
    expect(prepared.ok).toBe(true);
    expect(await db.tabs.count()).toBe(0);
    browser.permissions.contains.mockResolvedValue(true);
    permissionAdded();
    await vi.waitFor(async () => expect(await db.jobs.get('current')).toBeDefined());
    expect((await settled()).done).toBe(1);
    expect(browserTabs.has(1)).toBe(false);
    expect(sessionStorage.pendingCapture).toBeUndefined();
  });
  it('starts a permission-approved save only once when the event and popup both continue', async () => {
    const prepared = await send({ type: 'PREPARE_ASIDE', scope: 'window' });
    permissionAdded();
    await send({ type: 'RESUME_ASIDE', token: prepared.data.token });
    await settled();
    await send({ type: 'RESUME_ASIDE', token: prepared.data.token });
    expect(await db.sessions.count()).toBe(1);
    expect(await db.tabs.count()).toBe(1);
    expect(browser.tabs.captureVisibleTab).toHaveBeenCalledTimes(1);
  });
  it('does not capture newly opened tabs after permission was requested', async () => {
    const prepared = await send({ type: 'PREPARE_ASIDE', scope: 'window' });
    browserTabs.set(2, { ...tab(2), active: false });
    await send({ type: 'RESUME_ASIDE', token: prepared.data.token });
    await settled();
    expect(browserTabs.has(2)).toBe(true);
    expect((await db.tabs.toArray()).map((tab) => tab.sourceTabId)).toEqual([1]);
  });
  it('rejects a prepared request when its original tab navigated during the permission dialog', async () => {
    const prepared = await send({ type: 'PREPARE_ASIDE', scope: 'window' });
    browserTabs.get(1)!.url = 'https://example.com/other';
    const response = await send({ type: 'RESUME_ASIDE', token: prepared.data.token });
    expect(response.ok).toBe(false);
    expect(browser.tabs.remove).not.toHaveBeenCalledWith(1);
    expect(await db.tabs.count()).toBe(0);
  });
  it('drops denied and expired permission requests instead of unexpectedly replaying them', async () => {
    const prepared = await send({ type: 'PREPARE_ASIDE', scope: 'window' });
    await send({ type: 'DISCARD_ASIDE', token: prepared.data.token });
    await send({ type: 'RESUME_ASIDE', token: prepared.data.token });
    expect(browser.tabs.captureVisibleTab).not.toHaveBeenCalled();
    const expired = await send({ type: 'PREPARE_ASIDE', scope: 'window' });
    (sessionStorage.pendingCapture as { createdAt: number }).createdAt -= 121000;
    expect((await send({ type: 'RESUME_ASIDE', token: expired.data.token })).ok).toBe(false);
    expect(browser.tabs.captureVisibleTab).not.toHaveBeenCalled();
  });
  it('does not create or focus the manager after saving by default', async () => {
    await send({ type: 'ASIDE', scope: 'window', withoutPreviews: true });
    await settled();
    expect(
      browser.tabs.create.mock.calls.some(([args]: [chrome.tabs.CreateProperties]) =>
        args.url?.startsWith('chrome-extension:'),
      ),
    ).toBe(false);
    expect(browser.windows.update).not.toHaveBeenCalled();
    expect([...browserTabs.values()].some((tab) => tab.url === 'about:blank')).toBe(false);
  });
  it('opens the manager after saving when that preference is enabled', async () => {
    settings.mockResolvedValue({ ...DEFAULT_SETTINGS, openManagerAfterSaving: true });
    await send({ type: 'ASIDE', scope: 'window', withoutPreviews: true });
    await settled();
    expect(
      browser.tabs.create.mock.calls.some(
        ([args]: [chrome.tabs.CreateProperties]) =>
          args.url === 'chrome-extension://test-extension/manager.html',
      ),
    ).toBe(true);
    expect([...browserTabs.values()].some((tab) => tab.url === 'about:blank')).toBe(false);
  });
  it('also closes a pre-existing manager when it is the only tab keeping a fully saved window open', async () => {
    browserTabs.set(2, {
      ...tab(2, 'chrome-extension://test-extension/manager.html'),
      active: false,
    });
    await send({ type: 'ASIDE', scope: 'window', withoutPreviews: true });
    await settled();
    expect(browserTabs.has(2)).toBe(false);
    expect(browserTabs.size).toBe(0);
  });
  it.each(['discarded', 'frozen'] as const)(
    'saves and closes a %s tab without waking it by default',
    async (state) => {
      Object.assign(browserTabs.get(1)!, { active: false, [state]: true });
      await send({ type: 'ASIDE', scope: 'window' });
      const job = await settled();
      expect(job.failed).toBe(0);
      expect(job.message).toContain('1 sleeping tab saved without previews');
      expect(browser.tabs.captureVisibleTab).not.toHaveBeenCalled();
      expect(browser.tabs.update).not.toHaveBeenCalledWith(1, { active: true });
      expect(browserTabs.has(1)).toBe(false);
      expect((await db.tabs.toArray())[0]).toMatchObject({
        preview: 'skipped',
        closeState: 'closed',
        url: 'https://example.com/1',
      });
      expect(await db.screenshots.count()).toBe(0);
    },
  );
  it('wakes and captures a sleeping tab when the optional setting is enabled', async () => {
    settings.mockResolvedValue({ ...DEFAULT_SETTINGS, captureSleepingTabs: true });
    Object.assign(browserTabs.get(1)!, { active: false, discarded: true });
    const update = browser.tabs.update.getMockImplementation();
    browser.tabs.update.mockImplementation(async (id: number, patch: Partial<chrome.tabs.Tab>) => {
      if (id === 1 && patch.active)
        Object.assign(browserTabs.get(id)!, { discarded: false, frozen: false });
      return update(id, patch);
    });
    await send({ type: 'ASIDE', scope: 'window' });
    expect((await settled()).failed).toBe(0);
    expect(browser.tabs.captureVisibleTab).toHaveBeenCalledTimes(1);
    expect((await db.tabs.toArray())[0]).toMatchObject({ preview: 'ready', closeState: 'closed' });
  });
  it('rechecks sleeping state just before capture if Memory Saver discarded a later tab during the batch', async () => {
    browserTabs.set(2, { ...tab(2), active: false });
    browser.tabs.captureVisibleTab.mockImplementation(async () => {
      browserTabs.get(2)!.discarded = true;
      return 'data:image/jpeg;base64,fixture';
    });
    await send({ type: 'ASIDE', scope: 'window' });
    expect((await settled()).done).toBe(2);
    expect(browser.tabs.captureVisibleTab).toHaveBeenCalledTimes(1);
    expect(browser.tabs.update).not.toHaveBeenCalledWith(2, { active: true });
    expect((await db.tabs.toArray()).filter((tab) => tab.preview === 'skipped')).toHaveLength(1);
  });
  it('selects its temporary blank tab before closing an active source, avoiding automatic wake-up of the next tab', async () => {
    browserTabs.set(2, { ...tab(2), active: false, discarded: true });
    browser.tabs.remove.mockImplementation(async (id: number) => {
      if (id === 1)
        expect([...browserTabs.values()].find((tab) => tab.active)?.url).toBe('about:blank');
      browserTabs.delete(id);
    });
    await send({ type: 'ASIDE', scope: 'window' });
    expect((await settled()).failed).toBe(0);
    expect(browser.tabs.update).not.toHaveBeenCalledWith(2, { active: true });
  });
  it('times out a sleeping tab that never loads and preserves its source and URL', async () => {
    settings.mockResolvedValue({ ...DEFAULT_SETTINGS, captureSleepingTabs: true });
    Object.assign(browserTabs.get(1)!, { active: false, discarded: true });
    const update = browser.tabs.update.getMockImplementation();
    browser.tabs.update.mockImplementation(async (id: number, patch: Partial<chrome.tabs.Tab>) => {
      if (id === 1 && patch.active)
        Object.assign(browserTabs.get(id)!, { discarded: false, status: 'loading' });
      return update(id, patch);
    });
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    try {
      await send({ type: 'ASIDE', scope: 'window' });
      await vi.waitFor(() => expect(browser.tabs.update).toHaveBeenCalledWith(1, { active: true }));
      await vi.advanceTimersByTimeAsync(16000);
      const job = await settled();
      expect(job.failed).toBe(1);
      expect(job.issues[0]).toContain('15 seconds');
      expect(browserTabs.has(1)).toBe(true);
      expect(browser.tabs.captureVisibleTab).not.toHaveBeenCalled();
      expect((await db.tabs.toArray())[0]).toMatchObject({ preview: 'failed', closeState: 'open' });
    } finally {
      vi.useRealTimers();
    }
  });
});
