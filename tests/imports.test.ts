import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { AsideDatabase, clearLibrary } from '../lib/db';
import { createNativeBackup, importSessions, inspectImport } from '../lib/imports';

const url = 'https://example.com/research';
const aside = () => ({
  local: {
    collections: [
      {
        type: 'collection',
        title: null,
        timestamp: 1000,
        items: [
          { type: 'tab', title: 'First', url },
          {
            type: 'group',
            title: 'Research',
            color: 'purple',
            items: [
              { type: 'tab', title: 'Second', url },
              { type: 'tab', title: 'Settings', url: 'chrome-extension://other/options.html' },
            ],
          },
        ],
      },
    ],
  },
  sync: { analytics: true },
});
const manager = () => ({
  version: '1.0',
  exportedAt: '2026-10-24T23:36:17.965Z',
  sessions: [
    {
      id: 'foreign',
      name: 'Work',
      createdAt: 2000,
      tabs: [
        { title: 'A', url, windowId: 5, index: 2, pinned: true },
        { title: 'B', url: 'https://example.org/', windowId: 8, index: 0 },
      ],
    },
    { id: 'other', name: 'Personal', createdAt: 3000, tabs: [{ title: 'C', url }] },
  ],
});
let database: AsideDatabase;
beforeEach(() => {
  database = new AsideDatabase(`imports-${crypto.randomUUID()}`);
});
afterEach(async () => {
  await database.delete();
});

describe('import formats and validation', () => {
  it('maps Tabs Aside collections and groups, preserves repeated URLs, skips extension URLs', async () => {
    const plan = await inspectImport(JSON.stringify(aside()));
    expect(plan.source).toBe('Tabs Aside');
    expect(plan.sessions[0]).toMatchObject({ name: 'Session · 1970-01-01', createdAt: 1000 });
    expect(plan.sessions[0].tabs.map((t) => t.title)).toEqual(['First', 'Second']);
    expect(plan.sessions[0].tabs[1].group).toEqual({
      id: 0,
      title: 'Research',
      color: 'purple',
      collapsed: false,
    });
    expect(plan.skipped).toBe(1);
    expect(plan.warnings).toHaveLength(1);
  });
  it('preserves Tab Session Manager names, dates, array order, window boundaries and pinned state', async () => {
    const plan = await inspectImport(JSON.stringify(manager()));
    expect(plan.source).toBe('Tab Session Manager');
    expect(plan.sessions[0]).toMatchObject({ name: 'Work', createdAt: 2000 });
    expect(plan.sessions[0].tabs.map((t) => [t.title, t.windowId, t.position, t.pinned])).toEqual([
      ['A', 5, 0, true],
      ['B', 8, 1, false],
    ]);
    expect(plan.sessions[0].tabs.every((t) => !t.group)).toBe(true);
  });
  it('recognizes a BOM and fingerprints JSON independently of whitespace', async () => {
    const first = await inspectImport(JSON.stringify(manager()));
    expect((await inspectImport('\uFEFF' + JSON.stringify(manager(), null, 2))).fingerprint).toBe(
      first.fingerprint,
    );
  });
  it('rejects malformed JSON, unknown formats and unsupported native versions', async () => {
    await expect(inspectImport('{')).rejects.toThrow('not valid JSON');
    await expect(inspectImport('{}')).rejects.toThrow('Unrecognized backup');
    await expect(
      inspectImport(JSON.stringify({ format: 'tabs-aside-done-right', version: 2 })),
    ).rejects.toThrow('version is not supported');
  });
  it('skips unsafe addresses and rejects files without importable tabs', async () => {
    const data = manager();
    data.sessions = [data.sessions[0]];
    data.sessions[0].tabs = [{ title: 'Unsafe', url: 'javascript:alert(1)' }];
    await expect(inspectImport(JSON.stringify(data))).rejects.toThrow('no supported tabs');
    const data2 = aside();
    (data2.local.collections[0].items as unknown[]) = [{ type: 'unknown' }];
    await expect(inspectImport(JSON.stringify(data2))).rejects.toThrow('unknown collection item');
  });
  it('reports missing dates and invalid group colors', async () => {
    const data = aside();
    data.local.collections[0].timestamp = -1;
    (data.local.collections[0].items[1] as any).color = 'invalid';
    const plan = await inspectImport(JSON.stringify(data), 5000);
    expect(plan.sessions[0].createdAt).toBe(5000);
    expect(plan.sessions[0].tabs[1].group?.color).toBe('grey');
    expect(plan.warnings.join(' ')).toContain('date');
    expect(plan.warnings.join(' ')).toContain('colors');
  });
});

describe('atomic imports and native backups', () => {
  it('adds only selected sessions with fresh IDs and no screenshot or browser state', async () => {
    await database.sessions.add({
      id: 'existing',
      name: 'Existing',
      createdAt: 1,
      favorite: false,
    });
    const plan = await inspectImport(JSON.stringify(manager()));
    expect(await importSessions(plan, ['0'], false, database)).toEqual({ sessions: 1, tabs: 2 });
    expect(await database.sessions.count()).toBe(2);
    expect(await database.sessions.get('existing')).toBeDefined();
    const tabs = await database.tabs.toArray();
    expect(
      tabs.every(
        (t) =>
          t.preview === 'disabled' &&
          t.closeState === 'closed' &&
          !t.sourceTabId &&
          !t.previewBytes,
      ),
    ).toBe(true);
    expect(await database.screenshots.count()).toBe(0);
    expect(await database.sessions.get('foreign')).toBeUndefined();
  });
  it('tracks partial imports and blocks repeats unless explicitly allowed', async () => {
    const plan = await inspectImport(JSON.stringify(manager()));
    await importSessions(plan, ['0'], false, database);
    await expect(importSessions(plan, ['0', '1'], false, database)).rejects.toThrow(
      'already imported',
    );
    expect(await database.sessions.count()).toBe(1);
    await importSessions(plan, ['1'], false, database);
    await importSessions(plan, ['0'], true, database);
    expect(await database.sessions.count()).toBe(3);
    expect((await database.imports.get(plan.fingerprint))?.sessionKeys.sort()).toEqual(['0', '1']);
    await expect(importSessions(plan, [], false, database)).rejects.toThrow('Select at least');
  });
  it('rolls back sessions, tabs and the receipt on a storage failure', async () => {
    const plan = await inspectImport(JSON.stringify(manager()));
    const fail = () => {
      throw new Error('disk full');
    };
    database.tabs.hook('creating', fail);
    await expect(importSessions(plan, ['0'], false, database)).rejects.toThrow('disk full');
    database.tabs.hook('creating').unsubscribe(fail);
    expect(await database.sessions.count()).toBe(0);
    expect(await database.tabs.count()).toBe(0);
    expect(await database.imports.count()).toBe(0);
  });
  it('round trips native metadata and strips transient state and false screenshot availability', async () => {
    const plan = await inspectImport(JSON.stringify(aside()));
    await importSessions(plan, ['0'], false, database);
    const sessions = await database.sessions.toArray();
    await database.sessions.update(sessions[0].id, { favorite: true });
    const tabs = await database.tabs.toArray();
    await database.tabs.update(tabs[0].id, {
      preview: 'ready',
      previewBytes: 500,
      sourceTabId: 123,
      captureError: 'old failure',
      muted: true,
      favorite: true,
    });
    const backup = createNativeBackup(
      await database.sessions.toArray(),
      await database.tabs.toArray(),
    );
    expect(
      backup.tabs.every(
        (t) => !('preview' in t) && !('sourceTabId' in t) && !('captureError' in t),
      ),
    ).toBe(true);
    const parsed = await inspectImport(JSON.stringify(backup));
    expect(parsed.sessions[0].favorite).toBe(true);
    expect(parsed.sessions[0].tabs.map((t) => t.title)).toEqual(['First', 'Second']);
    expect(parsed.sessions[0].tabs.find((t) => t.group)?.group?.title).toBe('Research');
    await importSessions(parsed, [parsed.sessions[0].key], false, database);
    expect(
      (await database.tabs.toArray())
        .filter((t) => t.sessionId !== sessions[0].id)
        .every((t) => t.preview === 'disabled'),
    ).toBe(true);
  });
  it('accepts legacy native exports and rejects orphaned or duplicate IDs', async () => {
    const native: any = {
      format: 'tabs-aside-done-right',
      version: 1,
      sessions: [{ id: 's', name: 'Legacy', createdAt: 1 }],
      tabs: [
        { id: 'a', sessionId: 's', url, title: 'A', index: 1, preview: 'ready', sourceTabId: 42 },
        { id: 'b', sessionId: 's', url, title: 'B', index: 0 },
      ],
    };
    expect(
      (await inspectImport(JSON.stringify(native))).sessions[0].tabs.map((t) => t.title),
    ).toEqual(['B', 'A']);
    native.tabs[0].sessionId = 'missing';
    await expect(inspectImport(JSON.stringify(native))).rejects.toThrow('missing sessions');
    native.tabs[0].sessionId = 's';
    native.tabs[0].id = 'b';
    await expect(inspectImport(JSON.stringify(native))).rejects.toThrow('tab IDs must be unique');
  });
  it('clears import receipts along with the library', async () => {
    const plan = await inspectImport(JSON.stringify(manager()));
    await importSessions(plan, ['0'], false, database);
    await clearLibrary(database);
    expect(await database.imports.count()).toBe(0);
  });
  it('upgrades a version 1 library without losing existing data', async () => {
    const name = `old-${crypto.randomUUID()}`;
    const old = new Dexie(name);
    old.version(1).stores({
      sessions: 'id, createdAt',
      tabs: 'id, sessionId, createdAt, domain, [sessionId+index]',
      screenshots: 'tabId',
      jobs: 'id',
    });
    await old.table('sessions').add({ id: 'kept', name: 'Keep me', createdAt: 1, favorite: false });
    old.close();
    const upgraded = new AsideDatabase(name);
    try {
      expect((await upgraded.sessions.get('kept'))?.name).toBe('Keep me');
      expect(await upgraded.imports.count()).toBe(0);
    } finally {
      await upgraded.delete();
    }
  });
});
