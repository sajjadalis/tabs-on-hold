import { useState } from 'react';
import { db } from '../lib/db';
import { inspectImport, importSessions, MAX_IMPORT_BYTES, type ImportPlan } from '../lib/imports';
import { Dialog } from './shared';

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

export function ImportDialog({
  onClose,
  onComplete,
}: {
  onClose: () => void;
  onComplete: (result: { sessions: number; tabs: number }) => void;
}) {
  const [plan, setPlan] = useState<ImportPlan>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previous, setPrevious] = useState<string[]>([]);
  const [repeat, setRepeat] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const chosen = plan?.sessions.filter((s) => selected.has(s.key)) ?? [];
  const count = chosen.reduce((sum, session) => sum + session.tabs.length, 0);
  const eligible =
    plan?.sessions.filter((s) => s.tabs.length && (repeat || !previous.includes(s.key))) ?? [];
  const close = () => {
    if (!busy) onClose();
  };
  const read = async (file: File) => {
    setBusy(true);
    setError('');
    setPlan(undefined);
    setRepeat(false);
    setSelected(new Set());
    setPrevious([]);
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error('Choose a JSON backup smaller than 25 MB.');
      const result = await inspectImport(await file.text());
      const imported = (await db.imports.get(result.fingerprint))?.sessionKeys ?? [];
      setPrevious(imported);
      setSelected(
        new Set(
          result.sessions
            .filter((s) => s.tabs.length && !imported.includes(s.key))
            .map((s) => s.key),
        ),
      );
      setPlan(result);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const commit = async () => {
    if (!plan || busy) return;
    setBusy(true);
    setError('');
    try {
      onComplete(await importSessions(plan, [...selected], repeat));
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Import sessions"
      description="Add sessions from a JSON backup. Existing sessions stay in your library."
      onClose={close}
      error={error}
      wide
    >
      <div className="import-content" aria-busy={busy}>
        <label className="import-file">
          <strong>Choose a JSON backup</strong>
          <input
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void read(file);
            }}
          />
          <small>Tabs on Hold, Tabs Aside, or Tab Session Manager · Up to 25 MB</small>
        </label>
        {busy && <p role="status">{plan ? 'Importing sessions…' : 'Reading backup…'}</p>}
        {plan && (
          <>
            <p className="import-summary">
              <strong>{plan.source}</strong> · {plural(plan.sessions.length, 'session')} ·{' '}
              {plan.sessions.reduce((n, s) => n + s.tabs.length, 0)} supported tabs
            </p>
            <p className="import-explanation">
              Tabs are imported without screenshots. Restore a session, then set it aside with
              preview capture enabled to take screenshots.
            </p>
            {plan.warnings.length > 0 && (
              <ul className="import-warnings">
                {plan.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
            {previous.length > 0 && (
              <div className="import-repeat">
                <p>
                  Some sessions from this file were already imported. They are excluded by default.
                </p>
                <label>
                  <input
                    type="checkbox"
                    checked={repeat}
                    disabled={busy}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setRepeat(checked);
                      setSelected(
                        new Set(
                          plan.sessions
                            .filter((s) => s.tabs.length && (checked || !previous.includes(s.key)))
                            .map((s) => s.key),
                        ),
                      );
                    }}
                  />{' '}
                  Import these sessions again
                </label>
              </div>
            )}
            <label className="import-select-all">
              <input
                type="checkbox"
                disabled={busy || !eligible.length}
                checked={eligible.length > 0 && eligible.every((s) => selected.has(s.key))}
                onChange={(event) =>
                  setSelected(
                    event.target.checked ? new Set(eligible.map((s) => s.key)) : new Set(),
                  )
                }
              />{' '}
              Select all available sessions
            </label>
            <div className="import-sessions" aria-label="Sessions to import">
              {plan.sessions.map((session) => {
                const groupCount = new Set(
                  session.tabs.flatMap((t) => (t.group ? [`${t.windowId}:${t.group.id}`] : [])),
                ).size;
                return (
                  <div className="import-session" key={session.key}>
                    <input
                      type="checkbox"
                      aria-label={`Import ${session.name}`}
                      checked={selected.has(session.key)}
                      disabled={
                        busy || !session.tabs.length || (!repeat && previous.includes(session.key))
                      }
                      onChange={(event) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(session.key);
                          else next.delete(session.key);
                          return next;
                        })
                      }
                    />
                    <details>
                      <summary>
                        <strong>{session.name}</strong>
                        <small>
                          {new Date(session.createdAt).toLocaleDateString()} ·{' '}
                          {plural(session.tabs.length, 'tab')}
                          {groupCount ? ` · ${plural(groupCount, 'group')}` : ''}
                          {previous.includes(session.key) ? ' · Already imported' : ''}
                        </small>
                      </summary>
                      <ul>
                        {session.tabs.map((tab, i) => (
                          <li key={i}>
                            <span>{tab.title}</span>
                            <small>{tab.url}</small>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
      <div className="dialog-footer">
        <button className="secondary-button" onClick={close} disabled={busy}>
          Cancel
        </button>
        <button className="primary-button" onClick={() => void commit()} disabled={busy || !count}>
          Import {plural(chosen.length, 'session')} · {plural(count, 'tab')}
        </button>
      </div>
    </Dialog>
  );
}
