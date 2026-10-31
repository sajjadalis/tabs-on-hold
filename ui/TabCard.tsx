import { useEffect, useRef, useState, type DragEvent } from 'react';
import {
  ArrowUpRight,
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
import { usePreview } from './shared';

export function TabCard({
  tab,
  selected,
  onSelect,
  onRestore,
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
}: {
  tab: SavedTab;
  selected: boolean;
  onSelect: () => void;
  onRestore: () => void;
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
}) {
  const ref = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const [visible, setVisible] = useState(false);
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
  const initial = tab.domain
    .replace(/^www\./, '')
    .charAt(0)
    .toUpperCase();
  const hue = [...tab.domain].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  return (
    <article
      ref={ref}
      className={`tab-card ${list ? 'list-card' : ''} ${tab.preview !== 'ready' && tab.preview !== 'pending' ? 'without-preview' : ''} ${selected ? 'selected' : ''} ${dragging ? 'dragging' : ''}`}
      draggable={Boolean(onDragStart) && !disabled}
      onDragStart={(event) => {
        if ((event.target as HTMLElement).closest('details,input')) {
          event.preventDefault();
          return;
        }
        onDragStart?.(event);
      }}
      onDragEnd={onDragEnd}
    >
      {!list && (tab.preview === 'ready' || tab.preview === 'pending') && (
        <div className="card-preview">
          <button
            className="preview-hit"
            onClick={onPreview}
            disabled={tab.preview !== 'ready'}
            aria-label={`Enlarge preview of ${tab.title}`}
          >
            {url ? (
              <img src={url} alt={`Saved visible area of ${tab.title}`} draggable={false} />
            ) : (
              <div className="preview-placeholder">
                <span className="placeholder-window">
                  <span />
                  <span />
                  <span />
                  <i />
                </span>
                <span>
                  {tab.preview === 'ready'
                    ? 'Loading preview…'
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
          {tab.preview === 'ready' && (
            <div className="preview-actions">
              <button onClick={onPreview} aria-label={`Preview ${tab.title}`}>
                <Maximize2 size={16} />
                Preview
              </button>
              <button
                onClick={onRestore}
                disabled={disabled}
                aria-label={`Restore ${tab.title} from preview`}
              >
                <ArrowUpRight size={16} />
                Restore
              </button>
            </div>
          )}
        </div>
      )}
      {onDragStart && (
        <span className="tab-drag-handle" aria-hidden="true" title="Drag to another session">
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
          {initial}
        </span>
        <div className="card-copy">
          <h3 title={tab.title}>{tab.title}</h3>
          <p title={tab.url}>
            {tab.domain}
            {tab.pinned && <Pin size={11} />}
            {tab.preview === 'failed' && (
              <span title={tab.captureError}>
                <ImageOff size={12} />
              </span>
            )}
          </p>
          {sessionName && <span className="source-session">{sessionName}</span>}
        </div>
        <button
          className={`icon-button favorite-tab ${tab.favorite ? 'is-favorite' : ''}`}
          onClick={onFavorite}
          disabled={disabled}
          aria-label={`${tab.favorite ? 'Unfavorite' : 'Favorite'} ${tab.title}`}
        >
          <Star size={16} fill={tab.favorite ? 'currentColor' : 'none'} />
        </button>
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
      </div>
      {(list || tab.preview !== 'ready' || tab.closeState !== 'closed') && (
        <div className="card-footer">
          <span className="tab-state still-open">
            {tab.closeState === 'closed'
              ? ''
              : tab.closeState === 'changed'
                ? 'Original page changed'
                : 'Source left open'}
          </span>
          <div>
            {list && tab.preview === 'ready' && (
              <button
                className="restore-tab preview-tab"
                onClick={onPreview}
                aria-label={`Open preview of ${tab.title}`}
              >
                <Maximize2 size={15} />
                Preview
              </button>
            )}
            {(list || tab.preview !== 'ready') && (
              <button
                className="restore-tab"
                onClick={onRestore}
                disabled={disabled}
                aria-label={`Restore ${tab.title}`}
              >
                Restore <ArrowUpRight size={14} />
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
