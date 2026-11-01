import { useEffect, useRef, useState, type DragEvent } from 'react';
import {
  ArrowUpRight,
  ExternalLink,
  FolderInput,
  GripVertical,
  ImageOff,
  Maximize2,
  MoreHorizontal,
  Pin,
  Star,
  Trash2,
} from 'lucide-react';
import type { SavedTab } from '../lib/model';
import { inExtension } from '../lib/settings';
import { usePreview } from './shared';

export function TabCard({
  tab,
  selected,
  onSelect,
  onActivate,
  onRestore,
  onOpen,
  onDelete,
  onFavorite,
  onPreview,
  list,
  disabled,
  sessionName,
  onMove,
  canMove,
  onDragStart,
  onDragEnd,
  dragging = false,
  dropBefore = false,
  dropAfter = false,
}: {
  tab: SavedTab;
  selected: boolean;
  onSelect: () => void;
  onActivate: () => void;
  onRestore: () => void;
  onOpen: () => void;
  onDelete: () => void;
  onFavorite: () => void;
  onPreview: () => void;
  list: boolean;
  disabled: boolean;
  sessionName?: string;
  onMove: () => void;
  canMove: boolean;
  onDragStart?: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  dragging?: boolean;
  dropBefore?: boolean;
  dropAfter?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const [visible, setVisible] = useState(false);
  const [failedImage, setFailedImage] = useState<string>();
  const [failedFavicon, setFailedFavicon] = useState(false);
  useEffect(() => {
    if (list || !ref.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) setVisible(true);
        else setVisible(false);
      },
      { rootMargin: '240px' },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [list]);
  const { url } = usePreview(tab.id, visible && !list && tab.preview === 'ready');
  const hasPreview = Boolean(url && url !== failedImage);
  const initial = tab.domain
    .replace(/^www\./, '')
    .charAt(0)
    .toUpperCase();
  const hue = [...tab.domain].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  const faviconUrl =
    inExtension && /^https?:/i.test(tab.url)
      ? chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(tab.url)}&size=32`)
      : undefined;
  const stateLabel =
    tab.closeState === 'changed'
      ? 'Original page changed'
      : tab.closeState === 'open'
        ? 'Source left open'
        : '';
  const favoriteControl = (
    <button
      className={`icon-button favorite-tab ${tab.favorite ? 'is-favorite' : ''}`}
      onClick={onFavorite}
      disabled={disabled}
      aria-label={`${tab.favorite ? 'Unfavorite' : 'Favorite'} ${tab.title}`}
    >
      <Star size={16} fill={tab.favorite ? 'currentColor' : 'none'} />
    </button>
  );
  const menuControl = (
    <details className="tab-menu" name="saved-tab-actions" ref={menuRef}>
      <summary
        aria-label={`Actions for ${tab.title}`}
        aria-disabled={disabled}
        onClick={(event) => {
          if (disabled) event.preventDefault();
        }}
      >
        <MoreHorizontal size={18} />
      </summary>
      <div className="tab-menu-panel">
        <button
          disabled={disabled || !canMove}
          title={!canMove ? 'Save another session to create a destination.' : undefined}
          onClick={() => {
            menuRef.current?.removeAttribute('open');
            onMove();
          }}
        >
          <FolderInput size={16} />
          Move to session…
        </button>
        <button
          className="danger-text"
          disabled={disabled}
          onClick={() => {
            menuRef.current?.removeAttribute('open');
            onDelete();
          }}
        >
          <Trash2 size={16} />
          Delete saved tab
        </button>
      </div>
    </details>
  );
  return (
    <article
      ref={ref}
      data-tab-id={tab.id}
      className={`tab-card ${list ? 'list-card' : ''} ${selected ? 'selected' : ''} ${dragging ? 'dragging' : ''} ${dropBefore ? 'drop-before' : ''} ${dropAfter ? 'drop-after' : ''}`}
      onClick={(event) => {
        if (disabled) return;
        if (
          (event.target as Element).closest(
            'button, a, input, label, summary, details, .tab-drag-handle, .list-actions, .preview-actions',
          )
        )
          return;
        onActivate();
      }}
      onDragEnd={onDragEnd}
    >
      {!list && (
        <div className="card-preview">
          <button
            className="preview-hit"
            onClick={onPreview}
            disabled={!hasPreview}
            aria-label={`Enlarge preview of ${tab.title}`}
          >
            {hasPreview ? (
              <img
                src={url}
                alt={`Saved visible area of ${tab.title}`}
                draggable={false}
                onError={() => setFailedImage(url)}
              />
            ) : (
              <div className="preview-placeholder">
                <img
                  className="placeholder-art"
                  src="/preview-placeholder.svg"
                  alt=""
                  draggable={false}
                />
                <span>
                  {tab.preview === 'ready'
                    ? 'Preview unavailable'
                    : tab.preview === 'pending'
                      ? 'Preparing preview…'
                      : tab.preview === 'skipped'
                        ? 'Sleeping tab · preview skipped'
                        : tab.preview === 'failed'
                          ? 'Preview unavailable'
                          : 'Saved without a preview'}
                </span>
              </div>
            )}
          </button>
          <div className="preview-actions">
            {hasPreview && (
              <button onClick={onPreview} aria-label={`Preview ${tab.title}`}>
                <Maximize2 size={16} />
                Preview
              </button>
            )}
            <button
              onClick={onRestore}
              disabled={disabled}
              aria-label={`Restore ${tab.title} from preview`}
            >
              <ArrowUpRight size={16} />
              Restore
            </button>
          </div>
        </div>
      )}
      {onDragStart && (
        <span
          className="tab-drag-handle"
          aria-hidden="true"
          title="Drag to reorder or move"
          draggable={!disabled}
          onDragStart={(event) => {
            event.stopPropagation();
            if (ref.current) event.dataTransfer.setDragImage(ref.current, 24, 24);
            onDragStart(event);
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <GripVertical size={17} />
        </span>
      )}
      <label className="card-select" title={`Select ${tab.title}`}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          aria-label={`Select ${tab.title}`}
        />
      </label>
      <div className="card-body">
        <span
          className="site-icon"
          style={{ background: `hsl(${hue} 35% 92%)`, color: `hsl(${hue} 36% 32%)` }}
          aria-hidden="true"
        >
          {faviconUrl && !failedFavicon ? (
            <img src={faviconUrl} alt="" draggable={false} onError={() => setFailedFavicon(true)} />
          ) : (
            initial
          )}
        </span>
        <div className="card-copy">
          <h3 title={tab.title}>{tab.title}</h3>
          <p title={tab.url}>
            <span className="card-domain">{tab.domain}</span>
            <button
              className="open-tab"
              onClick={onOpen}
              disabled={disabled}
              title="Open without removing"
              aria-label={`Open ${tab.title} without removing`}
            >
              <ExternalLink size={13} aria-hidden="true" />
            </button>
            {tab.pinned && <Pin size={11} />}
            {tab.preview === 'failed' && (
              <span title={tab.captureError}>
                <ImageOff size={12} />
              </span>
            )}
            {list && sessionName && (
              <>
                <span className="meta-separator" aria-hidden="true">
                  ·
                </span>
                <span className="source-session" title={sessionName}>
                  {sessionName}
                </span>
              </>
            )}
            {list && stateLabel && (
              <>
                <span className="meta-separator" aria-hidden="true">
                  ·
                </span>
                <span className="tab-state still-open">{stateLabel}</span>
              </>
            )}
          </p>
          {!list && sessionName && <span className="source-session">{sessionName}</span>}
        </div>
        {!list && favoriteControl}
        {!list && menuControl}
      </div>
      {list ? (
        <div className="list-actions">
          {favoriteControl}
          {menuControl}
          <span className="list-action-divider" aria-hidden="true" />
          {tab.preview === 'ready' && (
            <button
              className="restore-tab preview-tab"
              onClick={onPreview}
              aria-label={`Open preview of ${tab.title}`}
            >
              <Maximize2 size={15} />
              Preview
            </button>
          )}
          <button
            className="restore-tab"
            onClick={onRestore}
            disabled={disabled}
            aria-label={`Restore ${tab.title}`}
          >
            Restore <ArrowUpRight size={14} />
          </button>
        </div>
      ) : (
        stateLabel && (
          <div className="card-footer">
            <span className="tab-state still-open">{stateLabel}</span>
          </div>
        )
      )}
    </article>
  );
}
