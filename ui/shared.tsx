import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertCircle, Check, LoaderCircle, Pause, X } from 'lucide-react';
import { db } from '../lib/db';
import { ensureCapturePermission, request } from '../lib/api';
import { inExtension, useSettings } from '../lib/settings';
import type { Scope, Settings } from '../lib/model';

export function useTheme(theme: Settings['theme']) {
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const changed = () => setSystemDark(media.matches);
    changed();
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  const resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);
  return resolved;
}

export function useDismissibleMenus() {
  useEffect(() => {
    const selector = 'details.session-menu[open], details.tab-menu[open]';
    const openMenus = () => [...document.querySelectorAll<HTMLDetailsElement>(selector)];
    const closeOutside = (target: EventTarget | null) => {
      for (const menu of openMenus()) {
        if (!(target instanceof Node) || !menu.contains(target)) menu.removeAttribute('open');
      }
    };
    const onPointerDown = (event: PointerEvent) => closeOutside(event.target);
    const onFocus = (event: FocusEvent) => closeOutside(event.target);
    const onClick = (event: MouseEvent) => {
      closeOutside(event.target);
      const button = event.target instanceof Element ? event.target.closest('button') : null;
      if (button && !button.disabled)
        button
          .closest<HTMLDetailsElement>('details.session-menu, details.tab-menu')
          ?.removeAttribute('open');
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const menus = openMenus();
      if (!menus.length) return;
      const focused = menus.find((menu) => menu.contains(document.activeElement)) ?? menus.at(-1);
      for (const menu of menus) menu.removeAttribute('open');
      focused?.querySelector<HTMLElement>('summary')?.focus();
      event.preventDefault();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}

export function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-mark ${small ? 'small' : ''}`} aria-hidden="true">
      <img src="/icon/128.png" alt="" draggable={false} />
    </span>
  );
}

export function Dialog({
  title,
  description,
  children,
  onClose,
  wide = false,
  error,
  initialFocus,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  error?: string;
  initialFocus?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    if (initialFocus) ref.current?.querySelector<HTMLElement>(initialFocus)?.focus();
  }, [initialFocus]);
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? 'wide' : ''}`}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog-head">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={19} />
        </button>
      </div>
      {error && (
        <div className="inline-error dialog-error" role="alert">
          {error}
        </div>
      )}
      {children}
    </dialog>
  );
}

export function useCapture(onError: (error: string) => void) {
  const [settings] = useSettings();
  const [scope, setScope] = useState<Scope>('window');
  const [count, setCount] = useState(0);
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    const refresh = () => {
      if (inExtension)
        void request<{ count: number }>({ type: 'COUNT', scope })
          .then((result) => setCount(result.count))
          .catch(() => {});
    };
    refresh();
    const timer = setInterval(refresh, 2500);
    return () => clearInterval(timer);
  }, [scope, settings.includePinned]);
  const start = async (withoutPreviews = false, copy = false) => {
    setStarting(true);
    try {
      if (
        settings.capturePreviews &&
        !withoutPreviews &&
        inExtension &&
        !(await chrome.permissions.contains({ origins: ['<all_urls>'] }))
      ) {
        // Chrome's permission prompt can destroy the popup. The worker owns this
        // intent before the prompt opens and resumes it when access is granted.
        const { token } = await request<{ token: string }>({ type: 'PREPARE_ASIDE', scope, copy });
        if (!(await ensureCapturePermission())) {
          await request({ type: 'DISCARD_ASIDE', token });
          throw new Error(
            'Screenshot access was not granted. Use “Save without previews” or disable capture in Settings.',
          );
        }
        await request({ type: 'RESUME_ASIDE', token });
      } else {
        await request({ type: 'ASIDE', scope, withoutPreviews, copy });
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setStarting(false);
    }
  };
  return { scope, setScope, count, starting, start };
}

export function OperationStatus({
  compact = false,
  floatingResult = false,
}: {
  compact?: boolean;
  floatingResult?: boolean;
}) {
  const job = useLiveQuery(() => db.jobs.get('current'));
  const [expanded, setExpanded] = useState(false);
  const [expiredResult, setExpiredResult] = useState<string>();
  const resultKey = job ? `${job.kind}:${job.updatedAt}:${job.message}` : '';
  const autoDismiss = Boolean(
    job &&
    (job.status === 'completed' || job.status === 'cancelled') &&
    !job.failed &&
    !job.issues.length,
  );
  const expiresAt = (job?.updatedAt ?? 0) + 5000;
  useEffect(() => {
    if (!autoDismiss) return;
    const timer = setTimeout(
      () => setExpiredResult(resultKey),
      Math.max(0, expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [autoDismiss, expiresAt, resultKey]);
  // Keep the operation record for recovery and reporting; expiration only hides
  // this result. Reloading must not bring old notifications back.
  if (!job || (autoDismiss && (expiredResult === resultKey || Date.now() >= expiresAt)))
    return null;
  const running = job.status === 'running';
  const floating =
    floatingResult && job.status === 'completed' && !job.failed && !job.issues.length;
  return (
    <div
      className={`operation ${running ? 'running' : job.failed || job.status === 'interrupted' ? 'attention' : 'success'} ${compact ? 'compact' : ''} ${floating ? 'floating-operation' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="operation-row">
        {running ? (
          <LoaderCircle className="spin" size={18} />
        ) : job.failed || job.status === 'interrupted' ? (
          <AlertCircle size={18} />
        ) : (
          <Check size={18} />
        )}
        <span>{job.message}</span>
        {running ? (
          <button
            className="text-button"
            disabled={job.cancelRequested}
            onClick={() => void request({ type: 'CANCEL' })}
          >
            <Pause size={14} />
            {job.cancelRequested ? 'Stopping…' : 'Cancel'}
          </button>
        ) : (
          <button
            className="icon-button"
            aria-label="Dismiss operation result"
            onClick={() =>
              void db.transaction('rw', db.jobs, async () => {
                const current = await db.jobs.get('current');
                if (
                  current &&
                  current.status !== 'running' &&
                  current.updatedAt === job.updatedAt &&
                  current.message === job.message
                )
                  await db.jobs.delete('current');
              })
            }
          >
            <X size={16} />
          </button>
        )}
      </div>
      {running && (
        <progress value={job.done} max={job.total || 1} aria-label="Operation progress" />
      )}
      {job.issues.length > 0 && (
        <>
          <button className="text-button details-button" onClick={() => setExpanded(!expanded)}>
            {expanded
              ? 'Hide details'
              : `View ${job.issues.length} ${job.issues.length === 1 ? 'issue' : 'issues'}`}
          </button>
          {expanded && (
            <ul className="issue-list">
              {job.issues.map((issue, index) => (
                <li key={index}>{issue}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

export function usePreview(tabId: string, enabled: boolean) {
  const image = useLiveQuery(
    () => (enabled ? db.screenshots.get(tabId) : undefined),
    [tabId, enabled],
  );
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!image) {
      setUrl(undefined);
      return;
    }
    const objectUrl = URL.createObjectURL(image.blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [image]);
  return { image, url };
}
