import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Archive,
  ArrowDownWideNarrow,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  FolderOpen,
  FolderInput,
  Grid2X2,
  HardDrive,
  Image,
  LayoutGrid,
  List,
  Monitor,
  MoreHorizontal,
  Moon,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  Star,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { clearLibrary, db, deletePreviews, deleteTabs, moveTabs } from '../lib/db';
import { request } from '../lib/api';
import {
  filterTabs,
  formatBytes,
  sortTabs,
  orderSessionTabs,
  type LibraryView,
  type SavedTab,
  type Session,
  type Sort,
} from '../lib/model';
import { inExtension, useSettings } from '../lib/settings';
import {
  BrandMark,
  Dialog,
  OperationStatus,
  useDismissibleMenus,
  usePreview,
  useTheme,
} from './shared';
import { TabCard } from './TabCard';
import { ImportDialog } from './ImportDialog';
import { createNativeBackup, MAX_IMPORT_BYTES } from '../lib/imports';
import { APP_VERSION } from '../lib/version';

type ConfirmAction = {
  title: string;
  description: string;
  label: string;
  action: () => Promise<void>;
};
type DropTarget = {
  sessionId: string;
  beforeId: string | null;
  anchorId: string | null;
  edge: 'before' | 'after';
  self: boolean;
};
const plural = (count: number, noun: string) =>
  `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`;
const TAB_DRAG_TYPE = 'application/x-tabs-aside-tab-ids';
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const dateLabel = (date: number) =>
  new Date(date).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });

function PreviewDialog({
  tab,
  close,
  onRestore,
  disabled,
}: {
  tab: SavedTab;
  close: () => void;
  onRestore: () => void;
  disabled: boolean;
}) {
  const { image, url } = usePreview(tab.id, true);
  return (
    <Dialog title={tab.title} description={tab.url} onClose={close} wide>
      <div className="large-preview">
        {url ? (
          <img src={url} alt={`Complete saved visible area of ${tab.title}`} />
        ) : (
          <p>This preview is no longer available.</p>
        )}
      </div>
      <div className="dialog-footer preview-info">
        <span>
          {image
            ? `${image.width} × ${image.height} · ${formatBytes(image.bytes)} · Captured ${new Date(image.capturedAt).toLocaleString()}`
            : 'Loading preview…'}
        </span>
        <div className="preview-dialog-actions">
          <button className="secondary-button" onClick={close}>
            Done
          </button>
          <button className="primary-button" onClick={onRestore} disabled={disabled}>
            <ArrowUpRight size={17} />
            Restore tab
          </button>
        </div>
      </div>
    </Dialog>
  );
}

export function Manager() {
  useDismissibleMenus();
  const [settings, updateSettings] = useSettings();
  const resolvedTheme = useTheme(settings.theme);
  const data = useLiveQuery(async () => ({
    sessions: await db.sessions.orderBy('createdAt').reverse().toArray(),
    tabs: await db.tabs.toArray(),
  }));
  const job = useLiveQuery(() => db.jobs.get('current'));
  const [view, setView] = useState<LibraryView>('sessions');
  const [layout, setLayout] = useState<'cards' | 'list'>(() =>
    localStorage.getItem('aside-layout') === 'list' ? 'list' : 'cards',
  );
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('newest');
  const [seed, setSeed] = useState(42);
  const [domain, setDomain] = useState('');
  const [previewFilter, setPreviewFilter] = useState('any');
  const [age, setAge] = useState('any');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [preview, setPreview] = useState<SavedTab>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [rename, setRename] = useState<Session>();
  const [renameValue, setRenameValue] = useState('');
  const [confirm, setConfirm] = useState<ConfirmAction>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [moveIds, setMoveIds] = useState<string[]>([]);
  const [destinationId, setDestinationId] = useState('');
  const [draggingIds, setDraggingIds] = useState<string[]>([]);
  const [dropTarget, setDropTarget] = useState<DropTarget>();
  const searchRef = useRef<HTMLInputElement>(null);
  const busy = pending || job?.status === 'running';
  const sessions = data?.sessions ?? [];
  const tabs = data?.tabs ?? [];
  const images = useMemo(
    () => ({
      bytes: tabs.reduce((sum, tab) => sum + (tab.previewBytes || 0), 0),
      count: tabs.filter((tab) => tab.preview === 'ready').length,
    }),
    [data],
  );

  useEffect(() => {
    localStorage.setItem('aside-layout', layout);
  }, [layout]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key === '/' &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement).tagName) &&
        !document.querySelector('dialog[open]')
      ) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    setSelected(new Set());
    setLimits({});
  }, [view, query, domain, previewFilter, age]);
  useEffect(() => {
    setLimits({});
  }, [settings.sessionTabLimit]);

  const filtered = useMemo(() => {
    const minDate = age === 'any' ? 0 : Date.now() - Number(age) * 86400000;
    return sortTabs(
      filterTabs(tabs, sessions, query, domain, previewFilter, view === 'favorites').filter(
        (tab) => tab.createdAt >= minDate,
      ),
      sort,
      seed,
    );
  }, [data, query, domain, previewFilter, age, view, sort, seed]);
  const groups = useMemo(() => {
    const map = new Map<string, SavedTab[]>();
    for (const tab of filtered) map.set(tab.sessionId, [...(map.get(tab.sessionId) || []), tab]);
    const result = sessions
      .filter((session) => map.has(session.id))
      .map((session) => ({
        session,
        tabs:
          sort === 'newest' || sort === 'oldest'
            ? orderSessionTabs(map.get(session.id)!)
            : map.get(session.id)!,
      }));
    if (sort === 'oldest') result.sort((a, b) => a.session.createdAt - b.session.createdAt);
    if (sort === 'title') result.sort((a, b) => a.session.name.localeCompare(b.session.name));
    return result;
  }, [filtered, data, sort]);
  const domains = [...new Set(tabs.map((tab) => tab.domain))].sort();
  const favoriteCount = tabs.filter(
    (tab) =>
      tab.favorite || sessions.some((session) => session.id === tab.sessionId && session.favorite),
  ).length;
  const activeFilters = Boolean(query || domain || previewFilter !== 'any' || age !== 'any');
  const selectedIds = [...selected].filter((id) => tabs.some((tab) => tab.id === id));
  const moveRecords = tabs.filter((tab) => moveIds.includes(tab.id));
  const destinations = sessions.filter((session) =>
    moveRecords.some((tab) => tab.sessionId !== session.id),
  );

  const run = async (action: () => Promise<unknown>, success?: string) => {
    setPending(true);
    setError('');
    try {
      await action();
      if (success) setNotice(success);
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setPending(false);
    }
  };
  const remove = (ids: string[]) =>
    setConfirm({
      title: `Delete ${plural(ids.length, 'saved tab')}?`,
      description:
        'Their saved records and screenshot files will be permanently removed from this device. Your open browser tabs will stay open. This cannot be undone.',
      label: 'Delete permanently',
      action: async () => {
        if (inExtension) await request({ type: 'DELETE', ids });
        else await deleteTabs(ids);
        setSelected(new Set());
        setNotice(`${plural(ids.length, 'saved tab')} deleted, including previews.`);
      },
    });
  const restore = (ids: string[], newWindow = false) =>
    void run(async () => {
      await request({ type: 'RESTORE', ids, remove: settings.removeAfterRestore, newWindow });
      setSelected(new Set());
    });
  const favoriteTab = (tab: SavedTab) =>
    void run(() => db.tabs.update(tab.id, { favorite: !tab.favorite }));
  const openTab = (id: string) =>
    void run(() => request({ type: 'OPEN', id }), 'Opened in a new tab. Saved copy kept.');
  const activateTab = (tab: SavedTab) => {
    if (settings.tabClickAction === 'open') return openTab(tab.id);
    if (settings.tabClickAction === 'restore') return restore([tab.id]);
    if (tab.preview === 'ready') return setPreview(tab);
    openTab(tab.id);
  };
  const openMove = (ids: string[]) => {
    setError('');
    setDestinationId('');
    setMoveIds([...new Set(ids)]);
  };
  const move = (ids: string[], target: string, beforeId?: string | null) =>
    void run(async () => {
      const sameSession = tabs
        .filter((tab) => ids.includes(tab.id))
        .every((tab) => tab.sessionId === target);
      const moved = inExtension
        ? (
            await request<{ moved: number }>({
              type: 'MOVE',
              ids,
              destinationId: target,
              beforeId,
            })
          ).moved
        : await moveTabs(ids, target, db, beforeId);
      setSelected(new Set());
      setMoveIds([]);
      setCollapsed((current) => {
        const next = new Set(current);
        next.delete(target);
        return next;
      });
      const name = sessions.find((session) => session.id === target)?.name || 'the chosen session';
      setNotice(
        !moved
          ? sameSession
            ? 'Those tabs are already in that order.'
            : 'Those tabs are already in that session.'
          : sameSession
            ? `Reordered ${plural(moved, 'tab')} in ${name}.`
            : `Moved ${plural(moved, 'tab')} to ${name}.`,
      );
    });
  const startDrag = (event: DragEvent<HTMLElement>, tab: SavedTab) => {
    const ids = selected.has(tab.id) ? selectedIds : [tab.id];
    event.dataTransfer.setData(TAB_DRAG_TYPE, JSON.stringify(ids));
    event.dataTransfer.effectAllowed = 'move';
    setDraggingIds(ids);
  };
  const endDrag = () => {
    setDraggingIds([]);
    setDropTarget(undefined);
  };
  const dropPosition = (event: DragEvent<HTMLElement>, sessionId: string): DropTarget => {
    const append: DropTarget = {
      sessionId,
      beforeId: null,
      anchorId: null,
      edge: 'after',
      self: false,
    };
    const container = (event.target as Element).closest<HTMLElement>('.tab-grid, .tab-list');
    if (!container) return append;
    const cards = [
      ...event.currentTarget.querySelectorAll<HTMLElement>('.tab-card[data-tab-id]'),
    ].filter((card) => !draggingIds.includes(card.dataset.tabId || ''));
    if (!cards.length) return append;
    const hovered = (event.target as Element).closest<HTMLElement>('.tab-card[data-tab-id]');
    if (hovered && draggingIds.includes(hovered.dataset.tabId || ''))
      return { ...append, self: true };
    let anchor = hovered && cards.includes(hovered) ? hovered : undefined;
    if (!anchor) {
      let nearest = cards[0];
      let distance = Infinity;
      for (const card of cards) {
        const box = card.getBoundingClientRect();
        const dx = event.clientX - (box.left + box.width / 2);
        const dy = event.clientY - (box.top + box.height / 2);
        const next = dx * dx + dy * dy;
        if (next < distance) {
          nearest = card;
          distance = next;
        }
      }
      anchor = nearest;
    }
    const box = anchor.getBoundingClientRect();
    const columns = container.classList.contains('tab-grid')
      ? getComputedStyle(container).gridTemplateColumns.trim().split(/\s+/).length
      : 1;
    const after =
      columns > 1
        ? event.clientX >= box.left + box.width / 2
        : event.clientY >= box.top + box.height / 2;
    const index = cards.indexOf(anchor);
    return {
      sessionId,
      beforeId: after ? (cards[index + 1]?.dataset.tabId ?? null) : (anchor.dataset.tabId ?? null),
      anchorId: anchor.dataset.tabId ?? null,
      edge: after ? 'after' : 'before',
      self: false,
    };
  };
  const dragOver = (event: DragEvent<HTMLElement>, sessionId: string) => {
    if (busy || !event.dataTransfer.types.includes(TAB_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const next = dropPosition(event, sessionId);
    setDropTarget((current) =>
      current?.sessionId === next.sessionId &&
      current?.anchorId === next.anchorId &&
      current?.edge === next.edge &&
      current?.self === next.self
        ? current
        : next,
    );
  };
  const drop = (event: DragEvent<HTMLElement>, sessionId: string) => {
    if (busy || !event.dataTransfer.types.includes(TAB_DRAG_TYPE)) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      const ids: unknown = JSON.parse(event.dataTransfer.getData(TAB_DRAG_TYPE));
      if (!Array.isArray(ids) || !ids.length || !ids.every((id) => typeof id === 'string'))
        throw new Error('This is not a saved-tab drag.');
      const position = dropPosition(event, sessionId);
      if (position.self) {
        endDrag();
        return;
      }
      move(ids, sessionId, position.anchorId === null ? undefined : position.beforeId);
    } catch (error) {
      setError(messageOf(error));
    }
    endDrag();
  };
  const select = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const clearFilters = () => {
    setQuery('');
    setDomain('');
    setPreviewFilter('any');
    setAge('any');
  };
  const exportLibrary = async () => {
    const snapshot = await db.transaction('r', db.sessions, db.tabs, db.screenshots, async () => ({
      sessions: await db.sessions.toArray(),
      tabs: await db.tabs.toArray(),
      screenshots: await db.screenshots.toArray(),
    }));
    // Encode after closing the read transaction: Blob reads are asynchronous.
    const payload = await createNativeBackup(
      snapshot.sessions,
      snapshot.tabs,
      snapshot.screenshots,
    );
    const file = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    if (file.size > MAX_IMPORT_BYTES) throw new Error('This backup exceeds the 256 MB JSON limit.');
    const url = URL.createObjectURL(file);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `tabs-on-hold-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    setNotice('Backup exported, including available screenshot previews.');
  };
  const renderCards = (records: SavedTab[], groupId: string) => {
    const batchSize = groupId === 'all' ? 60 : settings.sessionTabLimit || records.length;
    const visible = Math.min(records.length, limits[groupId] ?? batchSize);
    const hidden = records.length - visible;
    return (
      <>
        {hidden > 0 && (
          <p className="tab-visibility-note">
            Showing {visible.toLocaleString()} of {plural(records.length, 'tab')} ·{' '}
            {plural(hidden, 'tab')} hidden
          </p>
        )}
        <div className={layout === 'cards' ? 'tab-grid' : 'tab-list'}>
          {records.slice(0, visible).map((tab) => (
            <TabCard
              key={tab.id}
              tab={tab}
              list={layout === 'list'}
              disabled={Boolean(busy)}
              selected={selected.has(tab.id)}
              onSelect={() => select(tab.id)}
              onActivate={() => activateTab(tab)}
              onRestore={() => restore([tab.id])}
              onOpen={() => openTab(tab.id)}
              onDelete={() => remove([tab.id])}
              onFavorite={() => favoriteTab(tab)}
              onPreview={() => setPreview(tab)}
              onMove={() => openMove([tab.id])}
              canMove={sessions.length > 1}
              onDragStart={view === 'sessions' ? (event) => startDrag(event, tab) : undefined}
              onDragEnd={endDrag}
              dragging={draggingIds.includes(tab.id)}
              dropBefore={dropTarget?.anchorId === tab.id && dropTarget.edge === 'before'}
              dropAfter={dropTarget?.anchorId === tab.id && dropTarget.edge === 'after'}
              sessionName={
                view !== 'sessions'
                  ? sessions.find((session) => session.id === tab.sessionId)?.name
                  : undefined
              }
            />
          ))}
        </div>
        {hidden > 0 && (
          <div className="show-more-controls">
            <button
              className="secondary-button"
              onClick={() =>
                setLimits((current) => ({ ...current, [groupId]: visible + batchSize }))
              }
            >
              {hidden > batchSize ? 'Show next' : 'Show remaining'}{' '}
              {plural(Math.min(hidden, batchSize), 'tab')} <ChevronDown size={16} />
            </button>
            {hidden > batchSize && (
              <button
                className="text-button"
                onClick={() => setLimits((current) => ({ ...current, [groupId]: Infinity }))}
              >
                Show all {plural(records.length, 'tab')}
              </button>
            )}
          </div>
        )}
      </>
    );
  };

  return (
    <div className="app-shell" data-preview-fit={settings.cardImageFit}>
      <aside className="sidebar">
        <a
          href="#"
          className="brand"
          onClick={(event) => {
            event.preventDefault();
            setView('sessions');
            clearFilters();
          }}
        >
          <BrandMark />
          <span>
            <strong>Tabs on Hold</strong>
            <small>SAVE FOR LATER</small>
          </span>
        </a>
        <div className="workspace-label">
          <span className="workspace-dot" />
          Your saved library
        </div>
        <p className="nav-label">YOUR LIBRARY</p>
        <nav aria-label="Library">
          <button
            className={view === 'sessions' ? 'active' : ''}
            onClick={() => setView('sessions')}
          >
            <Archive size={18} />
            Sessions<span>{sessions.length}</span>
          </button>
          <button className={view === 'all' ? 'active' : ''} onClick={() => setView('all')}>
            <LayoutGrid size={18} />
            All tabs<span>{tabs.length}</span>
          </button>
          <button
            className={view === 'favorites' ? 'active' : ''}
            onClick={() => setView('favorites')}
          >
            <Star size={18} />
            Favorites<span>{favoriteCount}</span>
          </button>
        </nav>
        <div className="sidebar-tip">
          <div className="tip-heading">
            <Sparkles className="tip-icon" size={16} aria-hidden="true" />
            <strong>
              A clearer browser.
              <br />A clearer head.
            </strong>
          </div>
          <p>
            Save what matters.
            <br />
            Come back when you’re ready.
          </p>
          <span className="tip-lines" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </div>
        <div className="sidebar-bottom">
          <div className="storage-card">
            <div>
              <HardDrive size={15} />
              <span>Preview storage</span>
              <strong>{formatBytes(images?.bytes || 0)}</strong>
            </div>
            <div className="storage-line">
              <span
                style={{
                  width: `${Math.min(100, Math.max(3, ((images?.bytes || 0) / (500 * 1024 ** 2)) * 100))}%`,
                }}
              />
            </div>
            <p>{plural(images?.count || 0, 'preview')}</p>
          </div>
          <button
            className="sidebar-action"
            disabled={Boolean(busy)}
            onClick={() => setImportOpen(true)}
          >
            <FolderInput size={17} />
            Import sessions
          </button>
          <button
            className="sidebar-action"
            disabled={Boolean(busy) || !tabs.length}
            onClick={() => void run(exportLibrary)}
            title="Export a backup"
          >
            <Download size={17} />
            Export a backup
          </button>
          <button className="sidebar-action" onClick={() => setSettingsOpen(true)}>
            <Settings2 size={17} />
            Settings
          </button>
          <div className="sidebar-version">
            <span>Made for a little less clutter.</span>
            <span>v{APP_VERSION}</span>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="page-header">
          <h1>
            {view === 'sessions'
              ? 'Your sessions'
              : view === 'all'
                ? 'All your tabs'
                : 'Your favorites'}
            <span className="heading-dot">.</span>
          </h1>
          <div className="search-field header-search">
            <Search size={19} />
            <input
              ref={searchRef}
              aria-label="Search tabs and sessions"
              placeholder="Search tabs, websites, or sessions…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query ? (
              <button
                className="icon-button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
              >
                <X size={17} />
              </button>
            ) : (
              <kbd>/</kbd>
            )}
          </div>
          <div className="header-actions">
            <button
              className="secondary-button theme-toggle"
              aria-label={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              onClick={() =>
                void updateSettings({ theme: resolvedTheme === 'dark' ? 'light' : 'dark' }).catch(
                  (error) => setError(messageOf(error)),
                )
              }
            >
              {resolvedTheme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
            </button>
            <button
              className="secondary-button header-settings"
              aria-label="Open settings"
              title="Open settings"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 size={19} />
            </button>
          </div>
        </header>

        {!inExtension && (
          <div className="browser-preview-note">
            <Monitor size={16} />
            <span>
              Browser preview · To save and restore real tabs, load{' '}
              <strong>.output/chrome-mv3</strong> as an unpacked extension.
            </span>
          </div>
        )}
        <OperationStatus floatingResult />
        {error && (
          <div className="inline-error page-error" role="alert">
            <span>{error}</span>
            <button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}>
              <X size={16} />
            </button>
          </div>
        )}

        <section className="library-panel" aria-label="Saved tab library">
          <div className="library-toolbar">
            <div className="result-count">
              {filtered.length > 0 && (
                <input
                  type="checkbox"
                  aria-label="Select all matching tabs"
                  checked={filtered.every((tab) => selected.has(tab.id))}
                  onChange={(event) =>
                    setSelected(
                      event.target.checked ? new Set(filtered.map((tab) => tab.id)) : new Set(),
                    )
                  }
                />
              )}
              <strong>
                {view === 'sessions'
                  ? plural(groups.length, 'session')
                  : plural(filtered.length, 'tab')}
              </strong>
              {view === 'sessions' && (
                <>
                  <span className="meta-dot">·</span>
                  <span>{plural(filtered.length, 'tab')}</span>
                </>
              )}
              {activeFilters && (
                <button className="text-button" onClick={clearFilters}>
                  Clear filters
                </button>
              )}
              {view === 'sessions' && groups.length > 0 && (
                <button
                  className="icon-button"
                  aria-label={collapsed.size ? 'Expand all sessions' : 'Collapse all sessions'}
                  title={collapsed.size ? 'Expand all' : 'Collapse all'}
                  onClick={() =>
                    setCollapsed(
                      collapsed.size ? new Set() : new Set(groups.map((group) => group.session.id)),
                    )
                  }
                >
                  <ChevronDown size={16} />
                </button>
              )}
            </div>
            <div className="toolbar-actions">
              <div className="sort-control">
                <ArrowDownWideNarrow size={16} />
                <select
                  aria-label="Sort saved tabs"
                  value={sort}
                  onChange={(event) => setSort(event.target.value as Sort)}
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="title">Title A–Z</option>
                  <option value="domain">Website A–Z</option>
                  <option value="random">Random order</option>
                </select>
                {sort === 'random' && (
                  <button
                    className="icon-button"
                    aria-label="Reshuffle tabs"
                    onClick={() => setSeed(Math.floor(Math.random() * 2147483647))}
                  >
                    <Shuffle size={17} />
                  </button>
                )}
              </div>
              <button
                className={
                  'secondary-button filter-button ' +
                  (filtersOpen || activeFilters ? 'pressed' : '')
                }
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen(!filtersOpen)}
              >
                <SlidersHorizontal size={17} />
                Filters{activeFilters && <span className="filter-dot" />}
              </button>
              <div className="view-switch" aria-label="Display layout">
                <button
                  className={layout === 'cards' ? 'active' : ''}
                  aria-label="Card view"
                  aria-pressed={layout === 'cards'}
                  onClick={() => setLayout('cards')}
                >
                  <Grid2X2 size={18} />
                </button>
                <button
                  className={layout === 'list' ? 'active' : ''}
                  aria-label="List view"
                  aria-pressed={layout === 'list'}
                  onClick={() => setLayout('list')}
                >
                  <List size={19} />
                </button>
              </div>
              <label
                className="switch-label compact-restore"
                title="Delete saved records and previews only after each tab opens successfully."
              >
                <input
                  className="switch-input"
                  type="checkbox"
                  checked={settings.removeAfterRestore}
                  onChange={(event) =>
                    void updateSettings({ removeAfterRestore: event.target.checked })
                  }
                />
                <span className="switch-track" />
                <span>Remove after restoring</span>
              </label>
            </div>
          </div>
          {filtersOpen && (
            <div className="filter-panel">
              <label>
                Website
                <select
                  aria-label="Filter by website"
                  value={domain}
                  onChange={(event) => setDomain(event.target.value)}
                >
                  <option value="">Every website</option>
                  {domains.map((domain) => (
                    <option key={domain}>{domain}</option>
                  ))}
                </select>
              </label>
              <label>
                Preview
                <select
                  aria-label="Filter by preview"
                  value={previewFilter}
                  onChange={(event) => setPreviewFilter(event.target.value)}
                >
                  <option value="any">With or without previews</option>
                  <option value="yes">Has a preview</option>
                  <option value="no">No preview</option>
                </select>
              </label>
              <label>
                Saved
                <select
                  aria-label="Filter by saved date"
                  value={age}
                  onChange={(event) => setAge(event.target.value)}
                >
                  <option value="any">Any time</option>
                  <option value="1">Last 24 hours</option>
                  <option value="7">Last 7 days</option>
                  <option value="30">Last 30 days</option>
                </select>
              </label>
              <button className="text-button" onClick={clearFilters}>
                Reset filters
              </button>
            </div>
          )}
          {selectedIds.length > 0 && (
            <div className="selection-toolbar">
              <span>{selectedIds.length} selected</span>
              {selectedIds.length > 0 ? (
                <>
                  <button
                    className="text-button"
                    disabled={Boolean(busy)}
                    onClick={() => restore(selectedIds)}
                  >
                    <ArrowUpRight size={14} />
                    Restore selected
                  </button>
                  <button
                    className="text-button"
                    disabled={Boolean(busy) || sessions.length < 2}
                    onClick={() => openMove(selectedIds)}
                  >
                    <FolderInput size={16} />
                    Move to session…
                  </button>
                  <button
                    className="text-button danger-text"
                    disabled={Boolean(busy)}
                    onClick={() => remove(selectedIds)}
                  >
                    <Trash2 size={14} />
                    Delete selected
                  </button>
                  <button className="text-button" onClick={() => setSelected(new Set())}>
                    Clear selection
                  </button>
                </>
              ) : (
                view === 'sessions' && (
                  <button
                    className="text-button collapse-all"
                    onClick={() =>
                      setCollapsed(
                        collapsed.size
                          ? new Set()
                          : new Set(groups.map((group) => group.session.id)),
                      )
                    }
                  >
                    {collapsed.size ? 'Expand all' : 'Collapse all'}
                  </button>
                )
              )}
            </div>
          )}

          {!data ? (
            <div className="empty-state">
              <span className="empty-icon">
                <Archive size={28} />
              </span>
              <h2>Getting your space ready…</h2>
            </div>
          ) : !filtered.length ? (
            <div className="empty-state">
              <div className="empty-illustration" aria-hidden="true">
                <span />
                <span />
                <span>
                  <Archive size={28} />
                </span>
              </div>
              <p className="eyebrow">
                {activeFilters
                  ? 'LET’S TRY ANOTHER WAY'
                  : view === 'favorites'
                    ? 'KEEP THE GOOD ONES CLOSE'
                    : 'A FRESH START STARTS HERE'}
              </p>
              <h2>
                {activeFilters
                  ? 'No tabs found.'
                  : view === 'favorites'
                    ? 'Your favorites live here.'
                    : tabs.length
                      ? 'Nothing in this view yet.'
                      : 'Room for what’s next.'}
              </h2>
              <p>
                {activeFilters
                  ? 'Try a different word, website, or date range.'
                  : view === 'favorites'
                    ? 'Star a tab or session to find it here, whenever you need it.'
                    : 'Set your open tabs aside. We’ll keep their place,\nso you can get back to yours.'}
              </p>
              {activeFilters ? (
                <button className="secondary-button" onClick={clearFilters}>
                  <RotateCcw size={15} />
                  Clear filters
                </button>
              ) : (
                view !== 'favorites' && (
                  <p className="empty-start-hint">
                    Use the Tabs on Hold toolbar button to save your first session.
                  </p>
                )
              )}
              <div className="empty-features">
                <span>
                  <Image size={14} />
                  Visual previews
                </span>
                <span>
                  <Archive size={14} />
                  Organized sessions
                </span>
                <span>
                  <ArrowUpRight size={14} />
                  Easy to return
                </span>
              </div>
            </div>
          ) : view === 'sessions' ? (
            <div className="session-list">
              {groups.map(({ session, tabs: matching }) => {
                const all = tabs.filter((tab) => tab.sessionId === session.id);
                const isCollapsed = collapsed.has(session.id);
                const isAppendTarget =
                  dropTarget?.sessionId === session.id &&
                  dropTarget.anchorId === null &&
                  !dropTarget.self;
                return (
                  <section
                    className={`session ${isAppendTarget ? 'drop-target' : ''}`}
                    key={session.id}
                    aria-label={session.name}
                    onDragOver={(event) => dragOver(event, session.id)}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                        setDropTarget((current) =>
                          current?.sessionId === session.id ? undefined : current,
                        );
                    }}
                    onDrop={(event) => drop(event, session.id)}
                  >
                    {isAppendTarget && (
                      <span className="session-drop-label" aria-hidden="true">
                        Drop to place{' '}
                        {draggingIds.length > 1 ? `${draggingIds.length} tabs` : 'tab'}
                      </span>
                    )}
                    <header className="session-header">
                      <button
                        className="session-disclosure"
                        aria-expanded={!isCollapsed}
                        aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${session.name}`}
                        onClick={() =>
                          setCollapsed((current) => {
                            const next = new Set(current);
                            if (next.has(session.id)) next.delete(session.id);
                            else next.add(session.id);
                            return next;
                          })
                        }
                      >
                        {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                      </button>
                      <span className="session-folder">
                        <FolderOpen size={20} />
                      </span>
                      <div className="session-title">
                        <button
                          title="Rename session"
                          onClick={() => {
                            setRename(session);
                            setRenameValue(session.name);
                          }}
                        >
                          {session.name}
                        </button>
                        <p>
                          {dateLabel(session.createdAt)}
                          <span>·</span>
                          {activeFilters
                            ? `${matching.length} of ${all.length} tabs`
                            : plural(all.length, 'tab')}
                        </p>
                      </div>
                      <button
                        className={`icon-button session-star ${session.favorite ? 'is-favorite' : ''}`}
                        disabled={Boolean(busy)}
                        aria-label={`${session.favorite ? 'Unfavorite' : 'Favorite'} session ${session.name}`}
                        onClick={() =>
                          void run(() =>
                            db.sessions.update(session.id, { favorite: !session.favorite }),
                          )
                        }
                      >
                        <Star size={16} fill={session.favorite ? 'currentColor' : 'none'} />
                      </button>
                      <button
                        className="secondary-button session-restore"
                        disabled={Boolean(busy)}
                        title="Restore this session in a new window"
                        onClick={() =>
                          restore(
                            all.map((tab) => tab.id),
                            true,
                          )
                        }
                      >
                        <ArrowUpRight size={15} />
                        Restore {all.length}
                      </button>
                      <details className="session-menu">
                        <summary aria-label={`Options for ${session.name}`}>
                          <MoreHorizontal size={19} />
                        </summary>
                        <div>
                          <button
                            disabled={Boolean(busy)}
                            onClick={() =>
                              restore(
                                all.map((tab) => tab.id),
                                true,
                              )
                            }
                          >
                            Restore in a new window
                          </button>
                          <button
                            onClick={() => {
                              setRename(session);
                              setRenameValue(session.name);
                            }}
                          >
                            Rename session
                          </button>
                          <button onClick={() => setSelected(new Set(all.map((tab) => tab.id)))}>
                            Select all tabs in session
                          </button>
                          <button
                            className="danger-text"
                            disabled={Boolean(busy)}
                            onClick={() => remove(all.map((tab) => tab.id))}
                          >
                            Delete session & previews
                          </button>
                        </div>
                      </details>
                    </header>
                    {!isCollapsed && renderCards(matching, session.id)}
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="all-tabs-container">{renderCards(filtered, 'all')}</div>
          )}
        </section>
        <footer className="main-footer">
          <span>
            <Archive size={13} />
            Saved sessions, ready when you need them.
          </span>
          <button className="text-button" onClick={() => setHelpOpen(true)}>
            <ShieldCheck size={13} />
            Privacy & how it works
          </button>
        </footer>
      </main>
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setNotice('')}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {importOpen && (
        <ImportDialog
          onClose={() => setImportOpen(false)}
          onComplete={(result) => {
            setImportOpen(false);
            setView('sessions');
            setQuery('');
            setDomain('');
            setPreviewFilter('any');
            setAge('any');
            setNotice(
              `Imported ${plural(result.sessions, 'session')} and ${plural(result.tabs, 'tab')}.`,
            );
          }}
        />
      )}
      {moveIds.length > 0 && (
        <Dialog
          initialFocus="#move-destination"
          title={`Move ${plural(moveRecords.length, 'saved tab')}`}
          description="Choose the session these saved tabs should belong to."
          error={error}
          onClose={() => {
            if (!pending) setMoveIds([]);
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (destinationId) move(moveIds, destinationId);
            }}
          >
            <label className="field-label" htmlFor="move-destination">
              Destination session
            </label>
            <select
              id="move-destination"
              autoFocus
              required
              value={destinationId}
              onChange={(event) => setDestinationId(event.target.value)}
            >
              <option value="" disabled>
                Choose a session…
              </option>
              {destinations.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.name} ·{' '}
                  {plural(tabs.filter((tab) => tab.sessionId === session.id).length, 'tab')}
                </option>
              ))}
            </select>
            <p className="move-explanation">
              Tabs are appended to the destination with their existing previews. A source session is
              removed automatically if it becomes empty. Your open browser tabs stay as they are.
            </p>
            {!destinations.length && (
              <p className="inline-error">Save another session first to create a destination.</p>
            )}
            <div className="dialog-footer">
              <button
                type="button"
                className="secondary-button"
                disabled={pending}
                onClick={() => setMoveIds([])}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="primary-button"
                disabled={Boolean(busy) || !destinationId}
              >
                <FolderInput size={16} />
                {pending ? 'Moving…' : 'Move tabs'}
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {preview && (
        <PreviewDialog
          tab={preview}
          close={() => setPreview(undefined)}
          disabled={Boolean(busy)}
          onRestore={() => {
            restore([preview.id]);
            setPreview(undefined);
          }}
        />
      )}
      {rename && (
        <Dialog
          title="Give this session a name"
          description="Make it a little easier to find next time."
          error={error}
          onClose={() => setRename(undefined)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const name = renameValue.trim();
                if (!name) throw new Error('Please enter a session name.');
                await db.sessions.update(rename.id, { name });
                setRename(undefined);
              });
            }}
          >
            <label className="field-label" htmlFor="session-name">
              Session name
            </label>
            <input
              id="session-name"
              autoFocus
              maxLength={120}
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              required
            />
            <div className="dialog-footer">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setRename(undefined)}
              >
                Cancel
              </button>
              <button type="submit" className="primary-button" disabled={Boolean(busy)}>
                Save name
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {confirm && (
        <Dialog
          title={confirm.title}
          description={confirm.description}
          error={error}
          onClose={() => {
            if (!pending) setConfirm(undefined);
          }}
        >
          <div className="delete-explanation">
            <Trash2 size={20} />
            <span>
              Saved tabs and their images are deleted together. Exported backups are separate
              copies.
            </span>
          </div>
          <div className="dialog-footer">
            <button
              className="secondary-button"
              disabled={pending}
              onClick={() => setConfirm(undefined)}
            >
              Cancel
            </button>
            <button
              className="danger-button"
              disabled={Boolean(busy)}
              onClick={() =>
                void run(async () => {
                  await confirm.action();
                  setConfirm(undefined);
                })
              }
            >
              {pending ? 'Deleting…' : confirm.label}
            </button>
          </div>
        </Dialog>
      )}
      {settingsOpen && (
        <Dialog
          title="Settings"
          description="Choose how tabs are saved, displayed, and restored."
          error={error}
          onClose={() => setSettingsOpen(false)}
        >
          <div className="settings-section">
            <h3>Saving tabs</h3>
            <label className="setting-row">
              <span>
                <strong>Capture screenshot previews</strong>
                <small>
                  Save a screenshot of each tab's visible area. Existing previews are kept when this
                  is turned off.
                </small>
              </span>
              <input
                type="checkbox"
                checked={settings.capturePreviews}
                onChange={(event) => void updateSettings({ capturePreviews: event.target.checked })}
              />
            </label>
            <label className="setting-row">
              <span>
                <strong>Capture previews for sleeping tabs</strong>
                <small>
                  Load sleeping tabs for screenshots. This can take longer and use more memory and
                  data.
                </small>
              </span>
              <input
                type="checkbox"
                checked={settings.captureSleepingTabs}
                disabled={!settings.capturePreviews}
                onChange={(event) =>
                  void updateSettings({ captureSleepingTabs: event.target.checked })
                }
              />
            </label>
            <label className="setting-row">
              <span>
                <strong>Include pinned tabs</strong>
                <small>Pinned tabs stay open unless you enable this.</small>
              </span>
              <input
                type="checkbox"
                checked={settings.includePinned}
                onChange={(event) => void updateSettings({ includePinned: event.target.checked })}
              />
            </label>
            <label className="setting-row">
              <span>
                <strong>Open manager after saving</strong>
                <small>Show your saved library when saving finishes.</small>
              </span>
              <input
                type="checkbox"
                checked={settings.openManagerAfterSaving}
                onChange={(event) =>
                  void updateSettings({ openManagerAfterSaving: event.target.checked })
                }
              />
            </label>
            <label className="setting-row">
              <span>
                <strong>Preview quality</strong>
                <small>Higher quality uses more storage.</small>
              </span>
              <select
                aria-label="Screenshot quality"
                value={settings.quality}
                onChange={(event) =>
                  void updateSettings({ quality: event.target.value as typeof settings.quality })
                }
              >
                <option value="balanced">Balanced · 1280 px</option>
                <option value="high">Higher · 1920 px</option>
                <option value="small">Smaller · 960 px</option>
              </select>
            </label>
          </div>
          <div className="settings-section">
            <h3>Restoring & appearance</h3>
            <label className="setting-row">
              <span>
                <strong>Remove after restoring</strong>
                <small>
                  Deletes saved records and previews after Chrome opens each tab. Failed tabs stay
                  saved.
                </small>
              </span>
              <input
                type="checkbox"
                checked={settings.removeAfterRestore}
                onChange={(event) =>
                  void updateSettings({ removeAfterRestore: event.target.checked })
                }
              />
            </label>
            <label className="setting-row">
              <span>
                <strong>Clicking a saved tab</strong>
                <small>
                  Preview shows the screenshot when available, otherwise opens the tab. Open keeps
                  the saved copy; Restore follows the removal setting above.
                </small>
              </span>
              <select
                aria-label="Clicking a saved tab"
                value={settings.tabClickAction}
                onChange={(event) =>
                  void updateSettings({
                    tabClickAction: event.target.value as typeof settings.tabClickAction,
                  })
                }
              >
                <option value="preview">Preview</option>
                <option value="open">Open</option>
                <option value="restore">Restore</option>
              </select>
            </label>
            <label className="setting-row">
              <span>
                <strong>Appearance</strong>
              </span>
              <select
                aria-label="Appearance"
                value={settings.theme}
                onChange={(event) =>
                  void updateSettings({ theme: event.target.value as typeof settings.theme })
                }
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="system">Match system</option>
              </select>
            </label>
            <label className="setting-row">
              <span>
                <strong>Card screenshots</strong>
                <small>
                  Fill crops the edges; Fit shows the whole image. Full preview always shows the
                  complete screenshot.
                </small>
              </span>
              <select
                aria-label="Card screenshots"
                value={settings.cardImageFit}
                onChange={(event) =>
                  void updateSettings({
                    cardImageFit: event.target.value as typeof settings.cardImageFit,
                  })
                }
              >
                <option value="cover">Fill card (crop edges)</option>
                <option value="contain">Fit whole image</option>
              </select>
            </label>
            <label className="setting-row">
              <span>
                <strong>Tabs shown per session</strong>
                <small>
                  Show every saved tab by default, or start with a fixed number and reveal more as
                  needed.
                </small>
              </span>
              <select
                aria-label="Tabs shown per session"
                value={settings.sessionTabLimit}
                onChange={(event) =>
                  void updateSettings({
                    sessionTabLimit: Number(event.target.value) as typeof settings.sessionTabLimit,
                  })
                }
              >
                <option value={0}>All tabs (default)</option>
                <option value={12}>12 tabs</option>
                <option value={24}>24 tabs</option>
                <option value={48}>48 tabs</option>
                <option value={100}>100 tabs</option>
              </select>
            </label>
          </div>
          <div className="settings-section">
            <h3>Library & backups</h3>
            <p className="storage-summary">
              {plural(tabs.length, 'tab')} in {plural(sessions.length, 'session')} ·{' '}
              {formatBytes(images?.bytes || 0)} of previews
            </p>
            <button
              className="settings-action"
              disabled={Boolean(busy) || !tabs.length}
              onClick={() => void run(exportLibrary)}
            >
              <Download size={17} />
              <span>
                <strong>Export a backup</strong>
                <small>
                  Sessions, URLs, favorites, groups, and screenshot previews in one JSON file.
                </small>
              </span>
              <ArrowUpRight size={15} />
            </button>
            <button
              className="settings-action"
              disabled={Boolean(busy)}
              onClick={() => {
                setSettingsOpen(false);
                setImportOpen(true);
              }}
            >
              <FolderInput size={17} />
              <span>
                <strong>Import sessions</strong>
                <small>Import a Tabs on Hold, Tabs Aside, or Tab Session Manager backup.</small>
              </span>
              <ArrowUpRight size={15} />
            </button>
            <button
              className="settings-action"
              disabled={Boolean(busy) || !images?.count}
              onClick={() => {
                setSettingsOpen(false);
                setConfirm({
                  title: 'Delete all screenshot previews?',
                  description:
                    'Your saved tabs and sessions will stay. All stored preview images will be permanently deleted.',
                  label: 'Delete previews',
                  action: async () => {
                    if (inExtension) await request({ type: 'DELETE_PREVIEWS' });
                    else await deletePreviews();
                    setNotice('Previews deleted. Your saved tabs are still here.');
                  },
                });
              }}
            >
              <Image size={17} />
              <span>
                <strong>Delete previews, keep tabs</strong>
                <small>Free image storage without losing a single URL.</small>
              </span>
            </button>
            <button
              className="settings-action danger-text"
              disabled={Boolean(busy) || !tabs.length}
              onClick={() => {
                setSettingsOpen(false);
                setConfirm({
                  title: 'Delete your entire saved library?',
                  description: `This permanently deletes ${plural(tabs.length, 'tab')}, ${plural(sessions.length, 'session')}, and every stored screenshot. Settings and open browser tabs are kept.`,
                  label: 'Delete everything saved',
                  action: async () => {
                    if (inExtension) await request({ type: 'CLEAR' });
                    else await clearLibrary();
                    setNotice('Your saved library and all previews have been deleted.');
                  },
                });
              }}
            >
              <Trash2 size={17} />
              <span>
                <strong>Delete all saved data</strong>
                <small>Permanently remove sessions, tabs, and previews.</small>
              </span>
            </button>
          </div>
          <div className="dialog-footer">
            <span className="settings-version">Tabs on Hold · v{APP_VERSION}</span>
            <button className="primary-button" onClick={() => setSettingsOpen(false)}>
              Done
            </button>
          </div>
        </Dialog>
      )}
      {helpOpen && (
        <Dialog
          title="Privacy & help"
          description="How saving, previews, and restoring work."
          onClose={() => setHelpOpen(false)}
        >
          <div className="help-content">
            <p>
              <ShieldCheck size={18} />
              <span>
                <strong>Privacy.</strong> Your saved tabs and screenshots are stored on your
                computer and are not uploaded.
              </span>
            </p>
            <p>
              <Download size={18} />
              <span>
                <strong>Backups.</strong> Export saved tabs and screenshots from the sidebar or
                Settings. Keep a backup before uninstalling.
              </span>
            </p>
            <p>
              <Image size={18} />
              <span>
                <strong>Screenshot previews.</strong> Captures show the visible page area. Sleeping
                tabs stay asleep unless you enable previews for them. Some pages and video may not
                capture correctly.
              </span>
            </p>
            <p>
              <Archive size={18} />
              <span>
                <strong>Saving tabs.</strong> Tabs close after their data is saved. Failed captures
                and cancellation leave unfinished tabs open.
              </span>
            </p>
            <p>
              <ArrowUpRight size={18} />
              <span>
                <strong>Restoring tabs.</strong> Opens saved URLs. Unsaved forms, page history,
                scroll position, and playback state are not preserved.
              </span>
            </p>
            <p>
              <Trash2 size={18} />
              <span>
                <strong>Deleting saved items.</strong> Remove-after-restore deletes saved copies
                after they open successfully. Manual deletion asks for confirmation. Deleted items
                cannot be recovered without a backup.
              </span>
            </p>
            <div className="shortcut-list">
              <span>
                Search saved tabs<kbd>/</kbd>
              </span>
              <span>
                Set tabs aside<kbd>Alt + Shift + A</kbd>
              </span>
              <span>
                Open manager<kbd>Alt + Shift + S</kbd>
              </span>
            </div>
            <small>
              Shortcuts can be changed at chrome://extensions/shortcuts. Internal pages and
              incognito tabs are excluded from capture scopes.
            </small>
          </div>
          <div className="dialog-footer">
            <button className="primary-button" onClick={() => setHelpOpen(false)}>
              Got it
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
