import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { AsideDatabase, clearLibrary, storePreview } from '../lib/db';
import { createNativeBackup, importSessions, inspectImport } from '../lib/imports';
import { MAX_SCREENSHOT_BYTES } from '../lib/backup-images';

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const screenshot = () => ({
  mimeType: 'image/png',
  data: png,
  width: 1,
  height: 1,
  capturedAt: 42,
});
const imageBackup = () => ({
  format: 'tabs-on-hold',
  version: 2,
  includesScreenshots: true,
  sessions: [
    { id: 'a', name: 'A', createdAt: 1 },
    { id: 'b', name: 'B', createdAt: 2 },
  ],
  tabs: [
    { id: 'a1', sessionId: 'a', url, title: 'A', screenshot: screenshot() },
    { id: 'b1', sessionId: 'b', url, title: 'B', screenshot: screenshot() },
  ],
});

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
  // Browser decoding is exercised with real PNG/JPEG/WebP data in the smoke test.
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() })),
  );
});
afterEach(async () => {
  await database.delete();
  vi.unstubAllGlobals();
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
      inspectImport(JSON.stringify({ format: 'tabs-on-hold', version: 3 })),
    ).rejects.toThrow('backup format is not supported');
    await expect(
      inspectImport(JSON.stringify({ format: 'tabs-on-hold', version: 1 })),
    ).rejects.toThrow('backup format is not supported');
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
  it('round trips screenshot bytes and metadata with fresh tab IDs, including repeated URLs', async () => {
    await importSessions(await inspectImport(JSON.stringify(aside())), ['0'], false, database);
    const originals = await database.tabs.toArray();
    for (const [index, tab] of originals.entries()) {
      // Cross a Base64 chunk boundary and distinguish images for the same URL.
      const bytes = Uint8Array.from(atob(png), (character) => character.charCodeAt(0));
      await storePreview(
        tab.id,
        {
          blob: new Blob([bytes, new Uint8Array(24577 + index)], { type: 'image/png' }),
          bytes: bytes.length + 24577 + index,
          width: 1,
          height: 1,
          capturedAt: 100 + index,
        },
        database,
      );
    }
    const sourceImages = await database.screenshots.toArray();
    const backup = await createNativeBackup(
      await database.sessions.toArray(),
      await database.tabs.toArray(),
      sourceImages,
    );
    expect(backup.version).toBe(2);
    expect(backup.includesScreenshots).toBe(true);
    const plan = await inspectImport(JSON.stringify(backup));
    const restored = new AsideDatabase(`restored-${crypto.randomUUID()}`);
    try {
      await importSessions(
        plan,
        plan.sessions.map((session) => session.key),
        false,
        restored,
      );
      const imported = await restored.tabs.toArray();
      expect(imported).toHaveLength(2);
      for (const original of originals) {
        const tab = imported.find((tab) => tab.title === original.title)!;
        expect(tab.id).not.toBe(original.id);
        expect(tab.url).toBe(original.url);
        expect(tab.preview).toBe('ready');
        expect(tab).not.toHaveProperty('screenshot');
        const image = (await restored.screenshots.get(tab.id))!;
        const source = sourceImages.find((image) => image.tabId === original.id)!;
        expect(image.bytes).toBe(source.blob.size);
        expect(tab.previewBytes).toBe(image.bytes);
        expect(image).toMatchObject({
          width: source.width,
          height: source.height,
          capturedAt: source.capturedAt,
        });
        expect(image.blob.type).toBe('image/png');
        expect(await image.blob.arrayBuffer()).toEqual(await source.blob.arrayBuffer());
      }
      expect(await database.screenshots.count()).toBe(2);
    } finally {
      await restored.delete();
    }
  });
  it('imports images only for selected sessions and rolls back images when the receipt fails', async () => {
    const plan = await inspectImport(JSON.stringify(imageBackup()));
    await importSessions(plan, ['a'], false, database);
    expect(await database.screenshots.count()).toBe(1);
    expect((await database.tabs.toArray())[0].title).toBe('A');
    const fail = () => {
      throw new Error('receipt disk failure');
    };
    database.imports.hook('updating', fail);
    try {
      await expect(importSessions(plan, ['b'], false, database)).rejects.toThrow(
        'receipt disk failure',
      );
    } finally {
      database.imports.hook('updating').unsubscribe(fail);
    }
    expect(await database.sessions.count()).toBe(1);
    expect(await database.tabs.count()).toBe(1);
    expect(await database.screenshots.count()).toBe(1);
    expect((await database.imports.get(plan.fingerprint))?.sessionKeys).toEqual(['a']);
  });
  it('rolls back session and tab writes when screenshot storage fails', async () => {
    const plan = await inspectImport(JSON.stringify(imageBackup()));
    const fail = () => {
      throw new Error('image disk failure');
    };
    database.screenshots.hook('creating', fail);
    try {
      await expect(importSessions(plan, ['a'], false, database)).rejects.toThrow(
        'image disk failure',
      );
    } finally {
      database.screenshots.hook('creating').unsubscribe(fail);
    }
    expect(await database.sessions.count()).toBe(0);
    expect(await database.tabs.count()).toBe(0);
    expect(await database.screenshots.count()).toBe(0);
    expect(await database.imports.count()).toBe(0);
  });
  it('rejects signature-only image data before decoding or writing', async () => {
    for (const [mimeType, data] of [
      ['image/jpeg', '/9j/'],
      ['image/png', 'iVBORw0KGgo='],
    ]) {
      const backup = imageBackup();
      Object.assign(backup.tabs[0].screenshot, { mimeType, data });
      await expect(inspectImport(JSON.stringify(backup))).rejects.toThrow('image header');
    }
    expect(createImageBitmap).not.toHaveBeenCalled();
    expect(await database.tabs.count()).toBe(0);
    expect(await database.screenshots.count()).toBe(0);
  });
  it('rejects undecodable image data before writing', async () => {
    vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error('invalid image stream'));
    await expect(inspectImport(JSON.stringify(imageBackup()))).rejects.toThrow(
      'could not be decoded',
    );
    expect(await database.sessions.count()).toBe(0);
    expect(await database.tabs.count()).toBe(0);
    expect(await database.screenshots.count()).toBe(0);
    expect(await database.imports.count()).toBe(0);
  });
  it('rejects dimensions that disagree with the decoded image and releases the bitmap', async () => {
    const close = vi.fn();
    vi.mocked(createImageBitmap).mockResolvedValueOnce({
      width: 1,
      height: 1,
      close,
    } as unknown as ImageBitmap);
    const backup = imageBackup();
    backup.tabs[0].screenshot.width = 2;
    await expect(inspectImport(JSON.stringify(backup))).rejects.toThrow('do not match');
    expect(close).toHaveBeenCalledOnce();
    expect(await database.sessions.count()).toBe(0);
    expect(await database.screenshots.count()).toBe(0);
  });
  it('checks the encoded pixel count before allocating a bitmap', async () => {
    const bytes = Uint8Array.from(atob(png), (character) => character.charCodeAt(0));
    const header = new DataView(bytes.buffer);
    header.setUint32(16, 32768);
    header.setUint32(20, 32768);
    const backup = imageBackup();
    backup.tabs[0].screenshot.data = btoa(String.fromCharCode(...bytes));
    await expect(inspectImport(JSON.stringify(backup))).rejects.toThrow('screenshot dimensions');
    expect(createImageBitmap).not.toHaveBeenCalled();
    expect(await database.tabs.count()).toBe(0);
  });
  it.each([
    { data: 'not-base64!' },
    { data: 'A===' },
    { data: btoa('not an image') },
    { mimeType: 'image/svg+xml' },
    { mimeType: 'image/jpeg' },
    { width: -1 },
    { height: 1e9 },
    { capturedAt: 'yesterday' },
    { data: 'A'.repeat(4 * Math.ceil(MAX_SCREENSHOT_BYTES / 3) + 4) },
  ])('rejects a malformed or oversized screenshot before writing', async (patch) => {
    const backup = imageBackup();
    Object.assign(backup.tabs[1].screenshot, patch);
    await expect(inspectImport(JSON.stringify(backup))).rejects.toThrow(/screenshot/i);
    expect(await database.sessions.count()).toBe(0);
    expect(await database.screenshots.count()).toBe(0);
  });
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
    const backup = await createNativeBackup(
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
  it('accepts native exports and rejects orphaned or duplicate IDs', async () => {
    const native: any = {
      format: 'tabs-on-hold',
      version: 2,
      sessions: [{ id: 's', name: 'Saved', createdAt: 1 }],
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
