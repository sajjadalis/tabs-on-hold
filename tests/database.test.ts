import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AsideDatabase,
  clearLibrary,
  deletePreviews,
  deleteTabs,
  moveTabs,
  storePreview,
} from '../lib/db';
import { orderSessionTabs, type SavedTab } from '../lib/model';

let database: AsideDatabase;
function tab(id: string, sessionId: string): SavedTab {
  return {
    id,
    sessionId,
    title: id,
    url: 'https://example.com/',
    domain: 'example.com',
    createdAt: 1,
    index: 0,
    windowId: 1,
    pinned: false,
    muted: false,
    favorite: false,
    preview: 'disabled',
    closeState: 'closed',
  };
}
async function seed() {
  await database.sessions.bulkAdd([
    { id: 'a', name: 'A', createdAt: 1, favorite: false },
    { id: 'b', name: 'B', createdAt: 2, favorite: false },
  ]);
  await database.tabs.bulkAdd([tab('a1', 'a'), tab('a2', 'a'), tab('b1', 'b')]);
  for (const id of ['a1', 'a2', 'b1'])
    await storePreview(
      id,
      { blob: new Blob(['preview']), bytes: 7, width: 100, height: 60, capturedAt: 1 },
      database,
    );
}
beforeEach(async () => {
  database = new AsideDatabase(`test-${crypto.randomUUID()}`);
  await seed();
});

describe('moving tabs between sessions', () => {
  it('moves the same tab and image, and deletes its now-empty source session', async () => {
    const before = await database.tabs.get('b1');
    const image = await database.screenshots.get('b1');
    expect(await moveTabs(['b1'], 'a', database)).toBe(1);
    expect(await database.tabs.get('b1')).toEqual({ ...before, sessionId: 'a', position: 2 });
    expect(await database.sessions.get('b')).toBeUndefined();
    expect(await database.screenshots.count()).toBe(3);
    expect(await (await database.screenshots.get('b1'))!.blob.text()).toBe(
      await image!.blob.text(),
    );
    expect((await database.screenshots.get('b1'))?.capturedAt).toBe(image?.capturedAt);
  });
  it('keeps a nonempty source and appends after the destination, regardless of browser window IDs', async () => {
    await database.tabs.update('a1', { windowId: 1, index: 0, favorite: true, muted: true });
    await database.tabs.update('b1', { windowId: 100, index: 99 });
    await moveTabs(['a1'], 'b', database);
    expect(await database.sessions.get('a')).toBeDefined();
    expect(
      orderSessionTabs(await database.tabs.where('sessionId').equals('b').toArray()).map(
        (tab) => tab.id,
      ),
    ).toEqual(['b1', 'a1']);
    expect(await database.tabs.get('a1')).toMatchObject({
      windowId: 1,
      index: 0,
      favorite: true,
      muted: true,
      position: 1,
    });
  });
  it('preserves relative order for a bulk move even when selection IDs arrive reversed', async () => {
    expect(await moveTabs(['a2', 'a1', 'a2'], 'b', database)).toBe(2);
    expect(
      orderSessionTabs(await database.tabs.where('sessionId').equals('b').toArray()).map(
        (tab) => tab.id,
      ),
    ).toEqual(['b1', 'a1', 'a2']);
    expect(await database.sessions.get('a')).toBeUndefined();
  });
  it('treats a drop onto the current session as a no-op', async () => {
    const before = await database.tabs.toArray();
    expect(await moveTabs(['a1', 'a1'], 'a', database)).toBe(0);
    expect(await database.tabs.toArray()).toEqual(before);
    expect(await database.sessions.count()).toBe(2);
  });
  it('rejects a removed destination or missing source without changing the library', async () => {
    await expect(moveTabs(['a1'], 'missing', database)).rejects.toThrow('destination');
    await expect(moveTabs(['a1', 'missing'], 'b', database)).rejects.toThrow('removed');
    expect((await database.tabs.get('a1'))?.sessionId).toBe('a');
    expect(await database.screenshots.count()).toBe(3);
  });
  it('rolls back all tab moves, destination positions, and source cleanup if a write fails', async () => {
    const before = await database.tabs.toArray();
    const reject = (changes: object, id: string) => {
      if (id === 'a2' && (changes as Partial<SavedTab>).sessionId === 'b')
        throw new Error('move disk failure');
    };
    database.tabs.hook('updating', reject);
    try {
      await expect(moveTabs(['a1', 'a2'], 'b', database)).rejects.toThrow('move disk failure');
    } finally {
      database.tabs.hook('updating').unsubscribe(reject);
    }
    expect(await database.tabs.toArray()).toEqual(before);
    expect(await database.sessions.count()).toBe(2);
    expect(await database.screenshots.count()).toBe(3);
  });
});
afterEach(async () => {
  await database.delete();
});

describe('image ownership and permanent deletion', () => {
  it('deletes only the selected tab and its image, retaining the other session records', async () => {
    await deleteTabs(['a1'], database);
    expect(await database.tabs.get('a1')).toBeUndefined();
    expect(await database.screenshots.get('a1')).toBeUndefined();
    expect(await database.sessions.get('a')).toBeDefined();
    expect(await database.screenshots.count()).toBe(2);
  });
  it('removes the session when its final tab is removed', async () => {
    await deleteTabs(['a1', 'a2'], database);
    expect(await database.sessions.get('a')).toBeUndefined();
    expect(await database.tabs.get('b1')).toBeDefined();
    expect(await database.screenshots.count()).toBe(1);
  });
  it('rolls back tab and image deletion together if a database delete fails', async () => {
    const reject = () => {
      throw new Error('simulated disk failure');
    };
    database.tabs.hook('deleting', reject);
    await expect(deleteTabs(['a1', 'a2'], database)).rejects.toThrow('simulated disk failure');
    database.tabs.hook('deleting').unsubscribe(reject);
    expect(await database.tabs.count()).toBe(3);
    expect(await database.screenshots.count()).toBe(3);
    expect(await database.sessions.count()).toBe(2);
  });
  it('cannot recreate orphan images when a capture finishes after its tab was deleted', async () => {
    await deleteTabs(['a1'], database);
    await expect(
      storePreview(
        'a1',
        { blob: new Blob(['late']), bytes: 4, width: 10, height: 10, capturedAt: 1 },
        database,
      ),
    ).rejects.toThrow('removed');
    expect(await database.screenshots.get('a1')).toBeUndefined();
  });
  it('preview cleanup retains every URL and clears preview metadata', async () => {
    await deletePreviews(database);
    expect(await database.screenshots.count()).toBe(0);
    expect(await database.tabs.count()).toBe(3);
    expect(
      (await database.tabs.toArray()).every(
        (tab) => tab.preview === 'disabled' && tab.previewBytes === 0,
      ),
    ).toBe(true);
  });
  it('clear all purges sessions, URLs, image blobs, and operation records', async () => {
    await database.jobs.put({
      id: 'current',
      kind: 'capture',
      status: 'completed',
      message: '',
      total: 3,
      done: 3,
      failed: 0,
      updatedAt: 1,
      issues: [],
    });
    await clearLibrary(database);
    expect(
      await Promise.all([
        database.sessions.count(),
        database.tabs.count(),
        database.screenshots.count(),
        database.jobs.count(),
      ]),
    ).toEqual([0, 0, 0, 0]);
  });
});
