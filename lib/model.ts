export interface Session {
  id: string;
  name: string;
  createdAt: number;
  favorite: boolean;
}

export interface ImportReceipt {
  id: string;
  sessionKeys: string[];
  importedAt: number;
}

export interface SavedTab {
  id: string;
  sessionId: string;
  title: string;
  url: string;
  domain: string;
  createdAt: number;
  index: number;
  position?: number;
  windowId: number;
  sourceTabId?: number;
  pinned: boolean;
  muted: boolean;
  group?: {
    id: number;
    title: string;
    color: chrome.tabGroups.TabGroup['color'];
    collapsed: boolean;
  };
  favorite: boolean;
  preview: 'pending' | 'ready' | 'disabled' | 'failed' | 'skipped';
  previewBytes?: number;
  captureError?: string;
  closeState: 'open' | 'closed' | 'changed';
}

export interface Screenshot {
  tabId: string;
  blob: Blob;
  bytes: number;
  width: number;
  height: number;
  capturedAt: number;
}

export interface Job {
  id: 'current';
  kind: 'capture' | 'restore';
  status: 'running' | 'completed' | 'interrupted' | 'cancelled';
  message: string;
  total: number;
  done: number;
  failed: number;
  updatedAt: number;
  issues: string[];
  cancelRequested?: boolean;
}

export interface Settings {
  capturePreviews: boolean;
  captureSleepingTabs: boolean;
  removeAfterRestore: boolean;
  includePinned: boolean;
  openManagerAfterSaving: boolean;
  quality: 'balanced' | 'high' | 'small';
  theme: 'light' | 'dark' | 'system';
  cardImageFit: 'cover' | 'contain';
}

export const DEFAULT_SETTINGS: Settings = {
  capturePreviews: true,
  captureSleepingTabs: false,
  removeAfterRestore: true,
  includePinned: false,
  openManagerAfterSaving: false,
  quality: 'balanced',
  theme: 'light',
  cardImageFit: 'cover',
};

export type Scope = 'window' | 'selected' | 'current' | 'all';
export type Sort = 'newest' | 'oldest' | 'title' | 'domain' | 'random';
export type LibraryView = 'sessions' | 'all' | 'favorites';

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || new URL(url).protocol;
  } catch {
    return 'Unknown address';
  }
}

export function canRestore(url: string): boolean {
  try {
    return ['https:', 'http:', 'file:', 'chrome:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

// A stable shuffle keeps results from moving while a user browses or selects tabs.
export function randomKey(id: string, seed: number): number {
  let hash = seed | 0;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

export function filterTabs(
  tabs: SavedTab[],
  sessions: Session[],
  query: string,
  domain: string,
  preview: string,
  favorites = false,
): SavedTab[] {
  const names = new Map(sessions.map((session) => [session.id, session.name]));
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return tabs.filter((tab) => {
    const text = `${tab.title} ${tab.url} ${names.get(tab.sessionId) ?? ''}`.toLowerCase();
    return (
      terms.every((term) => text.includes(term)) &&
      (!domain || tab.domain === domain) &&
      (preview === 'any' ||
        (preview === 'yes' ? tab.preview === 'ready' : tab.preview !== 'ready')) &&
      (!favorites || tab.favorite || sessions.some((s) => s.id === tab.sessionId && s.favorite))
    );
  });
}

export function sortTabs(tabs: SavedTab[], sort: Sort, seed: number): SavedTab[] {
  return [...tabs].sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title) || a.index - b.index;
    if (sort === 'domain') return a.domain.localeCompare(b.domain) || a.index - b.index;
    if (sort === 'random') return randomKey(a.id, seed) - randomKey(b.id, seed);
    return (
      (sort === 'oldest' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt) ||
      a.index - b.index
    );
  });
}

// Older libraries retain browser window/index order until a session is rearranged.
export function orderSessionTabs(tabs: SavedTab[]): SavedTab[] {
  const positioned = tabs.every((tab) => Number.isFinite(tab.position));
  return [...tabs].sort(
    (a, b) =>
      (positioned ? a.position! - b.position! : 0) ||
      a.windowId - b.windowId ||
      a.index - b.index ||
      a.id.localeCompare(b.id),
  );
}
