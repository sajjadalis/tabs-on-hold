import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, Check, Image, ShieldCheck } from 'lucide-react';
import { db } from '../lib/db';
import { request } from '../lib/api';
import { useSettings } from '../lib/settings';
import { BrandMark, OperationStatus, useCapture, useTheme } from './shared';
import type { Scope } from '../lib/model';

export function Popup() {
  const [error, setError] = useState('');
  const capture = useCapture(setError);
  const [settings, update] = useSettings();
  useTheme(settings.theme);
  const stats = useLiveQuery(async () => ({
    tabs: await db.tabs.count(),
    sessions: await db.sessions.count(),
    busy: (await db.jobs.get('current'))?.status === 'running',
  }));
  return (
    <main className="popup-shell">
      <header className="popup-brand">
        <BrandMark small />
        <div>
          <strong>Tabs Aside</strong>
          <span>DONE RIGHT</span>
        </div>
        <span className="version-pill">v0.1.6</span>
      </header>
      <div className="popup-intro">
        <h1>
          Clear your tabs.
          <br />
          <span>Keep your place.</span>
        </h1>
        <p>Your next fresh start is one click away.</p>
      </div>
      <label className="field-label" htmlFor="popup-scope">
        Which tabs?
      </label>
      <select
        id="popup-scope"
        value={capture.scope}
        onChange={(event) => capture.setScope(event.target.value as Scope)}
      >
        <option value="window">This window</option>
        <option value="selected">Selected tabs</option>
        <option value="current">Current tab</option>
        <option value="all">All regular windows</option>
      </select>
      <button
        className="primary-button popup-aside"
        disabled={capture.starting || stats?.busy || !capture.count}
        onClick={() => {
          setError('');
          void capture.start();
        }}
      >
        <ArrowDownToLine size={18} />
        {capture.starting
          ? 'Preparing…'
          : `Set ${capture.count} ${capture.count === 1 ? 'tab' : 'tabs'} aside`}
      </button>
      <div className="popup-options">
        <label>
          <input
            type="checkbox"
            checked={settings.capturePreviews}
            onChange={(event) => void update({ capturePreviews: event.target.checked })}
          />
          <Image size={14} /> Capture visible-area previews
        </label>
        <p>
          {settings.capturePreviews
            ? settings.captureSleepingTabs
              ? 'Loaded and sleeping tabs are visited for previews. Waking sleeping tabs can take longer.'
              : 'Loaded tabs are visited for previews. Sleeping tabs are saved without waking them.'
            : 'Only titles, URLs, and tab information will be saved.'}
        </p>
      </div>
      <button
        className="text-button popup-fallback"
        disabled={capture.starting || stats?.busy || !capture.count}
        onClick={() => void capture.start(true)}
      >
        Save without previews
      </button>
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      <OperationStatus compact />
      <button
        className="open-library"
        onClick={() =>
          void request({ type: 'MANAGER' })
            .then(() => window.close())
            .catch((error) => setError(String(error)))
        }
      >
        <span>
          <Check size={16} />
          {stats?.tabs || 0} saved tabs <small>in {stats?.sessions || 0} sessions</small>
        </span>
        <ArrowUpRight size={18} />
      </button>
      <footer className="popup-privacy">
        <ShieldCheck size={13} /> On your device. Always yours.
      </footer>
    </main>
  );
}
