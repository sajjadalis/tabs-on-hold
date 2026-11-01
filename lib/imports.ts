import { db, type AsideDatabase } from './db';
import {
  canRestore,
  domainOf,
  orderSessionTabs,
  type SavedTab,
  type Session,
  type Screenshot,
} from './model';
import { decodeScreenshot, encodeScreenshot, type BackupScreenshot } from './backup-images';

export const MAX_IMPORT_BYTES = 256 * 1024 * 1024;
export const IMPORT_SIZE_MESSAGE = 'Choose a JSON backup no larger than 256 MB.';
const MAX_TABS = 100_000;
const COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
type RecordValue = Record<string, unknown>;
export type ImportTab = Pick<
  SavedTab,
  | 'title'
  | 'url'
  | 'createdAt'
  | 'index'
  | 'position'
  | 'windowId'
  | 'pinned'
  | 'muted'
  | 'favorite'
  | 'group'
> & { screenshot?: Omit<Screenshot, 'tabId'> };
export interface ImportSession {
  key: string;
  name: string;
  createdAt: number;
  favorite: boolean;
  tabs: ImportTab[];
}
export interface ImportPlan {
  source: string;
  fingerprint: string;
  sessions: ImportSession[];
  warnings: string[];
  skipped: number;
}
const record = (value: unknown): value is RecordValue =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const number = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : fallback;
const timestamp = (value: unknown, fallback: number) => {
  const date = number(value, fallback);
  return date >= 0 && date <= 8.64e15 ? date : fallback;
};
const invalid = (message: string): never => {
  throw new Error(message);
};
const array = (value: unknown, label: string): unknown[] =>
  Array.isArray(value) ? value : invalid(`Invalid backup: ${label} must be a list.`);
const object = (value: unknown, label: string): RecordValue =>
  record(value) ? value : invalid(`Invalid backup: ${label} must be an object.`);

// Adapt external structures into portable metadata. Never import live tab IDs,
// screenshot flags, settings, or analytics identifiers from a storage dump.
// Native backups explicitly carry validated screenshot data instead.
export async function inspectImport(contents: string, now = Date.now()): Promise<ImportPlan> {
  if (new Blob([contents]).size > MAX_IMPORT_BYTES) throw new Error(IMPORT_SIZE_MESSAGE);
  let data: unknown;
  try {
    data = JSON.parse(contents.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('This file is not valid JSON. Choose an exported JSON backup.');
  }
  const root = object(data, 'file');
  const warnings: string[] = [];
  const sessions: ImportSession[] = [];
  let skipped = 0;
  let seenTabs = 0;
  let fallbackDates = 0;
  let fallbackColors = 0;
  const savedDate = (value: unknown) => {
    if (timestamp(value, -1) === -1) fallbackDates++;
    return timestamp(value, now);
  };
  const groupOf = (value: unknown, fallbackId?: number): SavedTab['group'] => {
    if (!record(value)) return undefined;
    const id = number(value.id, fallbackId ?? -1);
    if (id < 0) return undefined;
    const color = COLORS.includes(String(value.color)) ? String(value.color) : 'grey';
    if (color !== value.color) fallbackColors++;
    return {
      id,
      title: text(value.title),
      color: color as NonNullable<SavedTab['group']>['color'],
      collapsed: value.collapsed === true,
    };
  };
  const tabOf = (
    value: unknown,
    date: number,
    position: number,
    group?: SavedTab['group'],
  ): ImportTab | undefined => {
    if (++seenTabs > MAX_TABS) throw new Error('This backup exceeds the 100,000-tab import limit.');
    if (!record(value) || !text(value.url) || !canRestore(text(value.url))) {
      skipped++;
      return;
    }
    const url = text(value.url);
    return {
      url,
      title: text(value.title) || url,
      createdAt: timestamp(value.createdAt, date),
      index: Math.max(0, number(value.index, position)),
      position,
      windowId: number(value.windowId, 0),
      pinned: value.pinned === true,
      muted: value.muted === true,
      favorite: value.favorite === true,
      group: group ?? groupOf(value.group),
    };
  };
  let source: string;
  if (root.format === 'tabs-on-hold') {
    if (root.version !== 2)
      throw new Error(
        'This backup format is not supported. Choose a JSON backup exported by Tabs on Hold.',
      );
    source = 'Tabs on Hold';
    const nativeTabs = array(root.tabs, 'tabs');
    const bySession = new Map<string, RecordValue[]>();
    const tabIds = new Set<string>();
    for (const value of nativeTabs) {
      const tab = object(value, 'tab');
      if (!text(tab.id) || tabIds.has(text(tab.id)) || !text(tab.sessionId))
        invalid('Invalid native backup: tab IDs must be unique and belong to a session.');
      tabIds.add(text(tab.id));
      const key = text(tab.sessionId);
      const bucket = bySession.get(key) ?? [];
      bucket.push(tab);
      bySession.set(key, bucket);
    }
    const keys = new Set<string>();
    for (const value of array(root.sessions, 'sessions')) {
      const item = object(value, 'session');
      const key = text(item.id);
      if (!key || keys.has(key)) invalid('Invalid native backup: session IDs must be unique.');
      keys.add(key);
      const date = savedDate(item.createdAt);
      const items = bySession.get(key) ?? [];
      const positioned = items.every(
        (t) => typeof t.position === 'number' && Number.isFinite(t.position),
      );
      items.sort(
        (a, b) =>
          (positioned ? Number(a.position) - Number(b.position) : 0) ||
          number(a.windowId, 0) - number(b.windowId, 0) ||
          number(a.index, 0) - number(b.index, 0) ||
          text(a.id).localeCompare(text(b.id)),
      );
      const tabs: ImportTab[] = [];
      for (const [i, tab] of items.entries()) {
        const result = tabOf(tab, date, i);
        if (!result) continue;
        if (tab.screenshot !== undefined)
          result.screenshot = await decodeScreenshot(tab.screenshot);
        tabs.push(result);
      }
      sessions.push({
        key,
        name: text(item.name) || `Session · ${new Date(date).toISOString().slice(0, 10)}`,
        createdAt: date,
        favorite: item.favorite === true,
        tabs,
      });
    }
    if ([...bySession.keys()].some((key) => !keys.has(key)))
      invalid('Invalid native backup: some tabs refer to missing sessions.');
  } else if (record(root.local) && Array.isArray(root.local.collections)) {
    source = 'Tabs Aside';
    for (const [i, value] of root.local.collections.entries()) {
      const item = object(value, 'collection');
      if (item.type !== 'collection') invalid('Invalid Tabs Aside backup: expected a collection.');
      const date = savedDate(item.timestamp);
      const tabs: ImportTab[] = [];
      let nextGroup = 0;
      const walk = (values: unknown[], group?: SavedTab['group'], depth = 0) => {
        if (depth > 20) invalid('This backup has too many nested groups.');
        for (const value of values) {
          const node = object(value, 'collection item');
          if (node.type === 'group')
            walk(array(node.items, 'group items'), groupOf(node, nextGroup++), depth + 1);
          else if (node.type === 'tab') {
            const tab = tabOf(node, date, tabs.length, group);
            if (tab) tabs.push(tab);
          } else invalid('Invalid Tabs Aside backup: unknown collection item type.');
        }
      };
      walk(array(item.items, 'collection items'));
      sessions.push({
        key: String(i),
        name: text(item.title) || `Session · ${new Date(date).toISOString().slice(0, 10)}`,
        createdAt: date,
        favorite: false,
        tabs,
      });
    }
  } else if (
    root.version === '1.0' &&
    typeof root.exportedAt === 'string' &&
    Array.isArray(root.sessions)
  ) {
    source = 'Tab Session Manager';
    for (const [i, value] of root.sessions.entries()) {
      const item = object(value, 'session');
      const date = savedDate(item.createdAt);
      // The exported array is already in display order; index is local to each window.
      const tabs = array(item.tabs, 'session tabs').flatMap((value, i) => {
        const tab = tabOf(value, date, i);
        return tab ? [tab] : [];
      });
      sessions.push({
        key: String(i),
        name: text(item.name) || `Session · ${new Date(date).toISOString().slice(0, 10)}`,
        createdAt: date,
        favorite: false,
        tabs,
      });
    }
  } else
    throw new Error(
      'Unrecognized backup. Choose a Tabs on Hold, Tabs Aside, or Tab Session Manager JSON export.',
    );
  if (sessions.length > 10_000)
    throw new Error('This backup exceeds the 10,000-session import limit.');
  if (skipped)
    warnings.push(
      `${skipped} tab${skipped === 1 ? '' : 's'} with missing or unsupported addresses will be skipped.`,
    );
  if (fallbackDates)
    warnings.push(
      `${fallbackDates} session date${fallbackDates === 1 ? '' : 's'} were missing or invalid; the import date will be used.`,
    );
  if (fallbackColors) warnings.push('Unrecognized group colors will use grey.');
  if (!sessions.some((session) => session.tabs.length))
    throw new Error('This backup contains no supported tabs to import.');
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(root)),
  );
  const fingerprint = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return { source, fingerprint, sessions, warnings, skipped };
}

export async function importSessions(
  plan: ImportPlan,
  keys: string[],
  allowRepeat = false,
  database: AsideDatabase = db,
) {
  const selected = plan.sessions.filter(
    (session) => keys.includes(session.key) && session.tabs.length,
  );
  if (!selected.length) throw new Error('Select at least one session to import.');
  return database.transaction(
    'rw',
    database.sessions,
    database.tabs,
    database.screenshots,
    database.imports,
    async () => {
      const receipt = await database.imports.get(plan.fingerprint);
      if (!allowRepeat && selected.some((session) => receipt?.sessionKeys.includes(session.key)))
        throw new Error(
          'Some selected sessions were already imported. Enable “Import these sessions again” to add another copy.',
        );
      const sessions: Session[] = [];
      const tabs: SavedTab[] = [];
      const screenshots: Screenshot[] = [];
      for (const item of selected) {
        const id = crypto.randomUUID();
        sessions.push({ id, name: item.name, createdAt: item.createdAt, favorite: item.favorite });
        tabs.push(
          ...item.tabs.map(({ screenshot, ...tab }): SavedTab => {
            const tabId = crypto.randomUUID();
            if (screenshot) screenshots.push({ ...screenshot, tabId });
            return {
              ...tab,
              id: tabId,
              sessionId: id,
              domain: domainOf(tab.url),
              preview: screenshot ? 'ready' : 'disabled',
              ...(screenshot ? { previewBytes: screenshot.bytes } : {}),
              closeState: 'closed',
            };
          }),
        );
      }
      await database.sessions.bulkAdd(sessions);
      await database.tabs.bulkAdd(tabs);
      await database.screenshots.bulkAdd(screenshots);
      await database.imports.put({
        id: plan.fingerprint,
        sessionKeys: [...new Set([...(receipt?.sessionKeys ?? []), ...selected.map((s) => s.key)])],
        importedAt: Date.now(),
      });
      return { sessions: sessions.length, tabs: tabs.length };
    },
  );
}

export async function createNativeBackup(
  sessions: Session[],
  tabs: SavedTab[],
  screenshots: Screenshot[] = [],
  now = Date.now(),
) {
  const byId = new Map(screenshots.map((image) => [image.tabId, image]));
  const ordered = sessions.flatMap((session) =>
    orderSessionTabs(tabs.filter((tab) => tab.sessionId === session.id)),
  );
  // Reject an over-limit export before allocating its Base64 strings.
  const imageBytes = ordered.reduce((sum, tab) => {
    const image = byId.get(tab.id);
    return sum + (image ? 4 * Math.ceil(image.blob.size / 3) : 0);
  }, 0);
  if (imageBytes > MAX_IMPORT_BYTES) throw new Error('This backup exceeds the 256 MB JSON limit.');
  const images = new Map<string, BackupScreenshot>();
  for (const tab of ordered) {
    const image = byId.get(tab.id);
    if (image) images.set(tab.id, await encodeScreenshot(image));
  }
  return {
    format: 'tabs-on-hold',
    version: 2,
    exportedAt: new Date(now).toISOString(),
    includesScreenshots: images.size > 0,
    sessions: sessions.map(({ id, name, createdAt, favorite }) => ({
      id,
      name,
      createdAt,
      favorite,
    })),
    tabs: ordered.map((tab) => ({
      id: tab.id,
      sessionId: tab.sessionId,
      title: tab.title,
      url: tab.url,
      createdAt: tab.createdAt,
      index: tab.index,
      position: tab.position,
      windowId: tab.windowId,
      pinned: tab.pinned,
      muted: tab.muted,
      favorite: tab.favorite,
      group: tab.group,
      ...(images.has(tab.id) ? { screenshot: images.get(tab.id) } : {}),
    })),
  };
}
