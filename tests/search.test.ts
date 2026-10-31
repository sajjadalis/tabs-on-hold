import { describe, expect, it } from 'vitest';
import { canRestore, filterTabs, sortTabs, type SavedTab } from '../lib/model';

const tabs: SavedTab[] = [
  {
    id: '1',
    sessionId: 's',
    title: 'A camera review',
    url: 'https://video.example/watch?v=1',
    domain: 'video.example',
    createdAt: 2,
    index: 2,
    windowId: 1,
    pinned: false,
    muted: false,
    favorite: false,
    preview: 'ready',
    closeState: 'closed',
  },
  {
    id: '2',
    sessionId: 't',
    title: 'Buy a camera',
    url: 'https://shop.example/camera',
    domain: 'shop.example',
    createdAt: 1,
    index: 1,
    windowId: 1,
    pinned: false,
    muted: false,
    favorite: true,
    preview: 'disabled',
    closeState: 'closed',
  },
];
const sessions = [
  { id: 's', name: 'Photography research', createdAt: 2, favorite: false },
  { id: 't', name: 'Shopping', createdAt: 1, favorite: false },
];
describe('finding tabs without losing original order', () => {
  it('combines session-name search, domain, preview and favorite filters', () => {
    expect(filterTabs(tabs, sessions, 'PHOTOGRAPHY camera', 'video.example', 'yes')).toEqual([
      tabs[0],
    ]);
    expect(filterTabs(tabs, sessions, 'camera', '', 'any', true)).toEqual([tabs[1]]);
  });
  it('keeps a shuffle stable and leaves source arrays and original indexes unchanged', () => {
    const original = structuredClone(tabs);
    expect(sortTabs(tabs, 'random', 42)).toEqual(sortTabs(tabs, 'random', 42));
    expect(tabs).toEqual(original);
    expect(sortTabs(tabs, 'oldest', 42).map((tab) => tab.id)).toEqual(['2', '1']);
  });
  it('rejects executable or malformed URLs before restore', () => {
    expect(canRestore('javascript:alert(1)')).toBe(false);
    expect(canRestore('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(canRestore('not a url')).toBe(false);
    expect(canRestore('https://example.com/?x=1#section')).toBe(true);
  });
});
