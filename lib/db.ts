import Dexie, { type Table } from 'dexie';
import {
  orderSessionTabs,
  type ImportReceipt,
  type Job,
  type SavedTab,
  type Screenshot,
  type Session,
} from './model';

export class AsideDatabase extends Dexie {
  sessions!: Table<Session, string>;
  tabs!: Table<SavedTab, string>;
  screenshots!: Table<Screenshot, string>;
  jobs!: Table<Job, string>;
  imports!: Table<ImportReceipt, string>;

  constructor(name = 'tabs-on-hold') {
    super(name);
    this.version(1).stores({
      sessions: 'id, createdAt',
      tabs: 'id, sessionId, createdAt, domain, [sessionId+index]',
      screenshots: 'tabId',
      jobs: 'id',
    });
    this.version(2).stores({ imports: 'id' });
  }
}

export const db = new AsideDatabase();

export async function moveTabs(
  ids: string[],
  destinationId: string,
  database = db,
  beforeId?: string | null,
): Promise<number> {
  return database.transaction('rw', database.sessions, database.tabs, async () => {
    if (!(await database.sessions.get(destinationId)))
      throw new Error('The destination session no longer exists.');
    const unique = [...new Set(ids)];
    const records = await database.tabs.bulkGet(unique);
    if (records.some((tab) => !tab))
      throw new Error('Some selected tabs were removed. Refresh your selection and try again.');
    const selected = records as SavedTab[];
    const destination = orderSessionTabs(
      await database.tabs.where('sessionId').equals(destinationId).toArray(),
    );
    // Undefined means a session-header/menu move; null explicitly targets the
    // end of the session and must also reorder tabs already in the destination.
    const moving =
      beforeId === undefined ? selected.filter((tab) => tab.sessionId !== destinationId) : selected;
    if (!moving.length) return 0;
    const movingIds = new Set(moving.map((tab) => tab.id));
    if (
      beforeId != null &&
      (movingIds.has(beforeId) || !destination.some((tab) => tab.id === beforeId))
    )
      throw new Error('That position is no longer available.');
    const sourceIds = [...new Set(moving.map((tab) => tab.sessionId))];
    const ordered = sourceIds.flatMap((id) =>
      orderSessionTabs(moving.filter((tab) => tab.sessionId === id)),
    );
    const stationary = destination.filter((tab) => !movingIds.has(tab.id));
    const insertAt =
      beforeId == null ? stationary.length : stationary.findIndex((tab) => tab.id === beforeId);
    if (beforeId != null && insertAt < 0) throw new Error('That position is no longer available.');
    const final = [...stationary.slice(0, insertAt), ...ordered, ...stationary.slice(insertAt)];
    const targetPositions = new Map(final.map((tab, position) => [tab.id, position]));
    const moved = moving.filter(
      (tab) => tab.sessionId !== destinationId || tab.position !== targetPositions.get(tab.id),
    ).length;
    // Give the whole destination a stable order, independent of its source monitors/windows.
    for (const [position, tab] of final.entries())
      await database.tabs.update(tab.id, {
        ...(tab.sessionId !== destinationId ? { sessionId: destinationId } : {}),
        position,
      });
    for (const id of sourceIds) {
      if (id !== destinationId && !(await database.tabs.where('sessionId').equals(id).count()))
        await database.sessions.delete(id);
    }
    // Screenshot keys remain tab IDs: moving never copies or removes image blobs.
    return moved;
  });
}

// The tab owns its image. There are no remote files or secondary image caches.
export async function deleteTabs(ids: string[], database = db): Promise<void> {
  await database.transaction(
    'rw',
    database.sessions,
    database.tabs,
    database.screenshots,
    async () => {
      const records = await database.tabs.bulkGet(ids);
      const sessions = new Set(records.flatMap((tab) => (tab ? [tab.sessionId] : [])));
      await database.screenshots.bulkDelete(ids);
      await database.tabs.bulkDelete(ids);
      for (const sessionId of sessions) {
        if ((await database.tabs.where('sessionId').equals(sessionId).count()) === 0) {
          await database.sessions.delete(sessionId);
        }
      }
    },
  );
}

export async function clearLibrary(database = db): Promise<void> {
  await database.transaction(
    'rw',
    database.sessions,
    database.tabs,
    database.screenshots,
    database.jobs,
    database.imports,
    async () => {
      await database.screenshots.clear();
      await database.tabs.clear();
      await database.sessions.clear();
      await database.jobs.clear();
      await database.imports.clear();
    },
  );
}

export async function deletePreviews(database = db): Promise<void> {
  await database.transaction('rw', database.tabs, database.screenshots, async () => {
    await database.screenshots.clear();
    await database.tabs.toCollection().modify((tab) => {
      tab.preview = 'disabled';
      tab.previewBytes = 0;
      delete tab.captureError;
    });
  });
}

export async function storePreview(
  tabId: string,
  image: Omit<Screenshot, 'tabId'>,
  database = db,
): Promise<void> {
  await database.transaction('rw', database.tabs, database.screenshots, async () => {
    const tab = await database.tabs.get(tabId);
    if (!tab) throw new Error('This saved tab was removed before its preview finished.');
    await database.screenshots.put({ ...image, tabId });
    await database.tabs.update(tabId, {
      preview: 'ready',
      previewBytes: image.bytes,
      captureError: undefined,
    });
  });
}
