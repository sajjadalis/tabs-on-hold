import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, type Settings } from './model';

export const inExtension = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);

export async function getSettings(): Promise<Settings> {
  if (inExtension) {
    const { settings } = await chrome.storage.local.get('settings');
    return { ...DEFAULT_SETTINGS, ...(settings as Partial<Settings> | undefined) };
  }
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('aside-settings') || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const settings = { ...(await getSettings()), ...patch };
  if (inExtension) await chrome.storage.local.set({ settings });
  else localStorage.setItem('aside-settings', JSON.stringify(settings));
  window.dispatchEvent(new CustomEvent('aside-settings', { detail: settings }));
  return settings;
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  useEffect(() => {
    void getSettings().then(setSettings);
    const custom = (event: Event) => setSettings((event as CustomEvent<Settings>).detail);
    const changed = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.settings)
        setSettings({ ...DEFAULT_SETTINGS, ...(changes.settings.newValue as Partial<Settings>) });
    };
    window.addEventListener('aside-settings', custom);
    if (inExtension) chrome.storage.onChanged.addListener(changed);
    return () => {
      window.removeEventListener('aside-settings', custom);
      if (inExtension) chrome.storage.onChanged.removeListener(changed);
    };
  }, []);
  return [
    settings,
    async (patch: Partial<Settings>) => {
      // Controlled checkboxes must respond during the click, before asynchronous
      // extension storage completes; otherwise React briefly flips them back.
      setSettings((current) => ({ ...current, ...patch }));
      try {
        setSettings(await saveSettings(patch));
      } catch (error) {
        setSettings(await getSettings());
        throw error;
      }
    },
  ] as const;
}
