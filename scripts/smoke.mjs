// Exercises the built extension in a throwaway Chromium profile, never your browser profile.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

const root = process.cwd();
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(root, '.cache', 'playwright');
const { chromium, expect } = await import('@playwright/test');
const fixture = path.join(root, '.cache', `smoke-extension-${Date.now()}`);
mkdirSync(fixture, { recursive: true });
cpSync(path.join(root, '.output', 'chrome-mv3'), fixture, { recursive: true });
const manifest = JSON.parse(readFileSync(path.join(fixture, 'manifest.json'), 'utf8'));
if (manifest.name !== 'Tabs on Hold' || manifest.short_name !== 'Tabs on Hold')
  throw new Error('Built extension has outdated branding.');
// Simulate a user who has already granted optional screenshot access.
// Only the throwaway copy is changed; the shipped manifest keeps access optional.
manifest.host_permissions = ['<all_urls>'];
delete manifest.optional_host_permissions;
writeFileSync(path.join(fixture, 'manifest.json'), JSON.stringify(manifest));
mkdirSync(path.join(root, 'artifacts'), { recursive: true });

const hits = new Map();
const server = createServer((request, response) => {
  hits.set(request.url, (hits.get(request.url) || 0) + 1);
  const name = request.url?.includes('video')
    ? 'A quiet moment'
    : request.url?.includes('studio')
      ? 'A field guide to better spaces'
      : request.url?.includes('pinned')
        ? 'Pinned workspace'
        : 'Design systems, thoughtfully made';
  const video = request.url?.includes('video');
  response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
  response.end(
    `<!doctype html><html><head><title>${name}</title><style>*{box-sizing:border-box}body{margin:0;font:16px 'Segoe UI',sans-serif;background:${video ? '#254b64' : '#f0eee8'};color:${video ? '#fff' : '#283b31'}}nav{padding:26px 8%;border-bottom:1px solid #89937b44;letter-spacing:3px;font-size:12px}main{padding:50px 8%;max-width:1000px}h1{font-size:64px;letter-spacing:-3px;line-height:1.05;max-width:650px;font-weight:500}p{line-height:1.8;max-width:440px;opacity:.7}.shape{position:absolute;right:12%;top:45%;width:180px;height:180px;border:40px solid #a5b59d;border-radius:50%;opacity:.7}.label{font-size:10px;letter-spacing:3px}footer{margin-top:50px;display:flex;gap:24px;font-size:12px}video{width:100vw;height:100vh;object-fit:cover;position:absolute;inset:0}canvas{display:none}.video-label{position:absolute;bottom:45px;left:50px;font-size:28px;z-index:2}</style></head><body>${video ? '<canvas id="canvas" width="1280" height="720"></canvas><video id="video" muted autoplay playsinline></video><div class="video-label">A quiet moment. A wider view.</div><script>const c=document.getElementById("canvas");const v=document.getElementById("video");const g=c.getContext("2d");function draw(){g.fillStyle="#254b64";g.fillRect(0,0,1280,720);g.fillStyle="#597e8e";g.beginPath();g.arc(1000,200,130,0,Math.PI*2);g.fill();requestAnimationFrame(draw)}draw();v.srcObject=c.captureStream(12);v.play();</script>' : `<nav>FORM & FIELD <span style="float:right;opacity:.5">Ideas for a considered life</span></nav><main><span class="label">THE NOTEBOOK / 001</span><h1>${name}.</h1><p>A collection of thoughtful details, useful ideas, and things worth coming back to.</p><footer><span>Explore the collection ↗</span><span>Read the story</span></footer><div class="shape"></div></main>`}</body></html>`,
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const context = await chromium.launchPersistentContext(
  path.join(root, '.cache', `smoke-profile-${Date.now()}`),
  {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 960 },
    args: [`--disable-extensions-except=${fixture}`, `--load-extension=${fixture}`],
  },
);
const errors = [];
context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
try {
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;
  const manager = await context.newPage();
  await manager.goto(`chrome-extension://${extensionId}/manager.html`);
  await expect(manager.getByRole('heading', { name: 'Your sessions.' })).toBeVisible();
  await manager.screenshot({ path: 'artifacts/manager-empty.png', fullPage: true });
  const read = (store) =>
    manager.evaluate(
      (store) =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open('tabs-aside-done-right');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const database = open.result;
            const transaction = database.transaction(store);
            const request = transaction.objectStore(store).getAll();
            request.onsuccess = () => {
              resolve(request.result);
              database.close();
            };
            request.onerror = () => reject(request.error);
          };
        }),
      store,
    );
  const send = (message) =>
    manager.evaluate((message) => chrome.runtime.sendMessage(message), message);
  const waitDone = async () => {
    await expect
      .poll(async () => (await read('jobs'))[0]?.status, { timeout: 30000 })
      .not.toBe('running');
    const [job] = await read('jobs');
    if (job?.status === 'interrupted') throw new Error(JSON.stringify(job));
    return job;
  };

  // The native toolbar badge must follow each window, including pinned/internal tabs.
  expect(manifest.action.default_icon['16']).toBe('icon/16.png');
  expect(manifest.action.default_icon['24']).toBe('icon/24.png');
  const verifyBadges = async () => {
    await expect
      .poll(() =>
        worker.evaluate(async () => {
          const tabs = await chrome.tabs.query({});
          const issues = [];
          for (const tab of tabs) {
            const count = tabs.filter((other) => other.windowId === tab.windowId).length;
            const text = await chrome.action.getBadgeText({ tabId: tab.id });
            const title = await chrome.action.getTitle({ tabId: tab.id });
            if (
              text !== String(count) ||
              !title.includes(`${count} ${count === 1 ? 'tab' : 'tabs'} in this window`)
            )
              issues.push({ tabId: tab.id, count, text, title });
          }
          return issues;
        }),
      )
      .toEqual([]);
  };
  await verifyBadges();
  const badgeWindow = await worker.evaluate(() => chrome.windows.create({ url: 'about:blank' }));
  const badgeTab = await manager.evaluate(async () => {
    const current = await chrome.tabs.getCurrent();
    return chrome.tabs.create({
      windowId: current.windowId,
      url: 'chrome://version',
      pinned: true,
    });
  });
  await verifyBadges();
  await worker.evaluate(({ tabId, windowId }) => chrome.tabs.move(tabId, { windowId, index: -1 }), {
    tabId: badgeTab.id,
    windowId: badgeWindow.id,
  });
  await verifyBadges();
  await worker.evaluate((tabId) => chrome.tabs.remove(tabId), badgeTab.id);
  await verifyBadges();
  await worker.evaluate((windowId) => chrome.windows.remove(windowId), badgeWindow.id);
  await verifyBadges();
  await manager.bringToFront();

  // Empty state and screenshot defaults.
  await expect(manager.getByText('Room for what’s next.')).toBeVisible();
  const sources = [];
  for (const name of ['design', 'studio', 'video']) {
    const page = await context.newPage();
    await page.goto(`${base}/${name}`);
    sources.push(page);
  }
  const pinned = await context.newPage();
  await pinned.goto(`${base}/pinned`);
  await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((tab) => tab.url?.includes('/pinned'));
    await chrome.tabs.update(tab.id, { pinned: true });
  });
  const count = await send({ type: 'COUNT', scope: 'window' });
  expect(count.data.count).toBe(3);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(
    popup.getByRole('checkbox', { name: 'Capture visible-area previews' }),
  ).toBeChecked();
  await expect(popup.getByRole('button', { name: 'Set 3 tabs aside', exact: true })).toBeEnabled();
  expect(
    await popup
      .locator('#popup-scope')
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(14);
  await popup.locator('.popup-shell').screenshot({ path: 'artifacts/popup.png' });
  await popup.getByRole('button', { name: 'Set 3 tabs aside', exact: true }).click();
  await expect.poll(async () => (await read('jobs'))[0]?.status).toBe('running');
  await popup.close(); // Closing the UI must not cancel an acknowledged background job.
  const captureJob = await waitDone();
  expect(captureJob.failed).toBe(0);
  expect(captureJob.done).toBe(3);
  // Successful results expire without deleting the durable operation record or
  // reappearing when the manager is reopened.
  await manager.bringToFront();
  await expect(manager.locator('.operation.success')).toBeVisible();
  await expect(manager.locator('.operation.success')).toHaveCount(0, { timeout: 7000 });
  expect((await read('jobs'))[0]).toMatchObject({ status: 'completed', kind: 'capture' });
  await manager.reload();
  await expect(manager.locator('.tab-card')).toHaveCount(3);
  await expect(manager.locator('.operation.success')).toHaveCount(0);
  const sessionActions = manager.locator('details.session-menu').first();
  const cardActions = manager.locator('details.tab-menu').first();
  for (const menu of [sessionActions, cardActions]) {
    const trigger = menu.locator('summary');
    await trigger.click();
    await expect(menu).toHaveJSProperty('open', true);
    await manager.getByRole('textbox', { name: 'Search tabs and sessions' }).click();
    await expect(menu).toHaveJSProperty('open', false);
    await trigger.focus();
    await trigger.press('Enter');
    await expect(menu).toHaveJSProperty('open', true);
    await manager.keyboard.press('Escape');
    await expect(menu).toHaveJSProperty('open', false);
    await expect(trigger).toBeFocused();
  }
  await sessionActions.locator('summary').click();
  await sessionActions
    .getByRole('button', { name: 'Select all tabs in session', exact: true })
    .click();
  await expect(sessionActions).toHaveJSProperty('open', false);
  await manager
    .locator('.selection-toolbar')
    .getByRole('button', { name: 'Clear selection', exact: true })
    .click();
  await sessionActions.locator('summary').click();
  await cardActions.locator('summary').click();
  await expect(sessionActions).toHaveJSProperty('open', false);
  await expect(cardActions).toHaveJSProperty('open', true);
  await cardActions.getByRole('button', { name: 'Delete saved tab', exact: true }).click();
  await expect(cardActions).toHaveJSProperty('open', false);
  await expect(manager.locator('dialog')).toBeVisible();
  await manager.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(sources.every((page) => page.isClosed())).toBe(true);
  expect(pinned.isClosed()).toBe(false);
  let saved = await read('tabs');
  expect(saved).toHaveLength(3);
  expect(
    saved.every(
      (tab) => tab.preview === 'ready' && tab.previewBytes > 0 && tab.closeState === 'closed',
    ),
  ).toBe(true);
  const imageInfo = await manager.evaluate(async () => {
    const open = indexedDB.open('tabs-aside-done-right');
    const database = await new Promise((resolve) => {
      open.onsuccess = () => resolve(open.result);
    });
    const request = database.transaction('screenshots').objectStore('screenshots').getAll();
    const images = await new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result);
    });
    database.close();
    return images.map((image) => ({
      type: image.blob.type,
      width: image.width,
      height: image.height,
      bytes: image.bytes,
    }));
  });
  expect(
    imageInfo.every(
      (image) =>
        image.type === 'image/webp' && image.width <= 1280 && image.height > 0 && image.bytes > 0,
    ),
  ).toBe(true);
  const videoColor = await manager.evaluate(
    async (id) => {
      const open = indexedDB.open('tabs-aside-done-right');
      const database = await new Promise((resolve) => {
        open.onsuccess = () => resolve(open.result);
      });
      const request = database.transaction('screenshots').objectStore('screenshots').get(id);
      const image = await new Promise((resolve) => {
        request.onsuccess = () => resolve(request.result);
      });
      database.close();
      const bitmap = await createImageBitmap(image.blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      const pixel = [
        ...ctx.getImageData(Math.floor(bitmap.width / 2), Math.floor(bitmap.height / 2), 1, 1).data,
      ];
      bitmap.close();
      return pixel;
    },
    saved.find((tab) => tab.title === 'A quiet moment').id,
  );
  expect(Math.abs(videoColor[0] - 37)).toBeLessThan(15);
  expect(Math.abs(videoColor[1] - 75)).toBeLessThan(15);
  expect(Math.abs(videoColor[2] - 100)).toBeLessThan(15);
  await expect(manager.locator('.tab-card')).toHaveCount(3);
  await expect(manager.locator('.preview-hit > img')).toHaveCount(3);
  await manager.bringToFront();
  // A full gallery verifies actual above-the-fold density, not just an empty layout.
  const galleryIds = await manager.evaluate(async () => {
    const open = indexedDB.open('tabs-aside-done-right');
    const database = await new Promise((resolve) => {
      open.onsuccess = () => resolve(open.result);
    });
    const readTx = database.transaction(['tabs', 'screenshots']);
    const tabsRequest = readTx.objectStore('tabs').getAll();
    const imageRequest = readTx.objectStore('screenshots').getAll();
    const [tabs, images] = await Promise.all([
      new Promise((resolve) => {
        tabsRequest.onsuccess = () => resolve(tabsRequest.result);
      }),
      new Promise((resolve) => {
        imageRequest.onsuccess = () => resolve(imageRequest.result);
      }),
    ]);
    const ids = [];
    // Simulate screenshots from an ultrawide monitor, a portrait monitor, and a square window.
    // Generate blobs before opening the write transaction, which must not await canvas work.
    const variants = await Promise.all(
      [
        [960, 270],
        [300, 600],
        [600, 600],
      ].map(async ([width, height], index) => {
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = ['#46788a', '#9bb190', '#c4ab81'][index];
        ctx.fillRect(0, 0, width, height);
        ctx.strokeStyle = '#ffffffaa';
        ctx.lineWidth = 10;
        ctx.strokeRect(5, 5, width - 10, height - 10);
        ctx.fillStyle = '#fff';
        ctx.font = '24px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(['Ultrawide', 'Portrait', 'Square'][index], width / 2, height / 2);
        const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 });
        return { blob, bytes: blob.size, width, height, capturedAt: Date.now() };
      }),
    );
    const write = database.transaction(['tabs', 'screenshots'], 'readwrite');
    for (let i = 3; i < 12; i++) {
      const template = tabs[i % tabs.length];
      const id = `gallery-${i}`;
      ids.push(id);
      const image = i < 6 ? variants[i - 3] : images.find((image) => image.tabId === template.id);
      const title =
        i < 6
          ? ['Ultrawide monitor example', 'Portrait monitor example', 'Square monitor example'][
              i - 3
            ]
          : `${template.title} · ${i + 1}`;
      write
        .objectStore('tabs')
        .put({ ...template, id, index: i, position: i, title, previewBytes: image.bytes });
      write.objectStore('screenshots').put({ ...image, tabId: id });
    }
    await new Promise((resolve) => {
      write.oncomplete = resolve;
    });
    database.close();
    return ids;
  });
  // Native IndexedDB fixture writes bypass Dexie's mutation broadcasts.
  await manager.reload();
  await manager.setViewportSize({ width: 1440, height: 800 });
  await expect(manager.locator('.tab-card')).toHaveCount(12);
  await expect(manager.locator('.preview-hit > img')).toHaveCount(12);
  const monitorShapes = await manager
    .locator('.preview-hit > img')
    .evaluateAll((images) => images.map((image) => image.naturalWidth / image.naturalHeight));
  expect(monitorShapes.some((ratio) => ratio > 3)).toBe(true);
  expect(monitorShapes.some((ratio) => ratio < 0.6)).toBe(true);
  const frames = await manager.locator('.card-preview').evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { width: box.width, height: box.height };
    }),
  );
  expect(frames.every((frame) => Math.abs(frame.width / frame.height - 16 / 9) < 0.025)).toBe(true);
  expect(
    await manager
      .locator('.preview-hit > img')
      .first()
      .evaluate((image) => getComputedStyle(image).objectFit),
  ).toBe('cover');
  const secondRowLast = await manager.locator('.tab-card').nth(7).boundingBox();
  expect(secondRowLast.y + secondRowLast.height).toBeLessThanOrEqual(800);
  const firstCard = await manager.locator('.tab-card').first().boundingBox();
  expect(firstCard.y).toBeLessThan(230);
  expect(await manager.getByRole('button', { name: /Set .*tabs aside/ }).count()).toBe(0);
  expect(
    Math.abs(
      (await manager.locator('.header-search').boundingBox()).y -
        (await manager.locator('.page-header h1').boundingBox()).y,
    ),
  ).toBeLessThan(16);
  expect(
    await manager
      .locator('.compact-restore')
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(14);
  await manager.screenshot({ path: 'artifacts/manager-sessions.png', fullPage: false });
  // Mixed cards share their frame/body geometry, including missing and corrupt blobs.
  await manager.evaluate(async () => {
    const database = await new Promise((resolve) => {
      const open = indexedDB.open('tabs-aside-done-right');
      open.onsuccess = () => resolve(open.result);
    });
    const template = await new Promise((resolve) => {
      database.transaction('tabs').objectStore('tabs').getAll().onsuccess = (event) =>
        resolve(event.target.result[0]);
    });
    const write = database.transaction(['tabs', 'screenshots'], 'readwrite');
    ['disabled', 'skipped', 'failed', 'pending', 'ready', 'ready'].forEach((preview, index) => {
      const id = `placeholder-${index}`;
      write.objectStore('tabs').put({
        ...template,
        id,
        title: `Placeholder ${index}`,
        preview,
        previewBytes: 0,
        position: -10 + index,
        index: -10 + index,
        closeState: 'closed',
      });
      if (index === 5)
        write.objectStore('screenshots').put({
          tabId: id,
          blob: new Blob(['invalid-image'], { type: 'image/webp' }),
          bytes: 13,
          width: 100,
          height: 100,
          capturedAt: 1,
        });
    });
    await new Promise((resolve) => {
      write.oncomplete = resolve;
    });
    database.close();
  });
  await manager.reload();
  const mixedCards = manager.locator('.tab-card').filter({ hasText: /Placeholder [0-5]/ });
  await expect(mixedCards).toHaveCount(6);
  for (const card of await mixedCards.all()) {
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator('.preview-placeholder')).toBeVisible();
    await expect(card.locator('.placeholder-art')).toHaveJSProperty('naturalWidth', 144);
    await expect(card.locator('.preview-hit')).toBeDisabled();
    await expect(card.getByRole('button', { name: /^Preview / })).toHaveCount(0);
    await card.hover();
    await expect(card.getByRole('button', { name: /^Restore / })).toBeVisible();
  }
  const geometry = await manager.locator('.tab-card').evaluateAll((cards) =>
    cards.map((card) => {
      const frame = card.querySelector('.card-preview').getBoundingClientRect();
      const body = card.querySelector('.card-body').getBoundingClientRect();
      return {
        height: card.getBoundingClientRect().height,
        ratio: frame.width / frame.height,
        body: body.height,
      };
    }),
  );
  expect(geometry.every((box) => Math.abs(box.ratio - 16 / 9) < 0.025)).toBe(true);
  expect(new Set(geometry.map((box) => box.height)).size).toBe(1);
  expect(new Set(geometry.map((box) => box.body)).size).toBe(1);
  await manager.locator('.tab-card').first().scrollIntoViewIfNeeded();
  await manager.screenshot({ path: 'artifacts/manager-mixed-previews.png', fullPage: false });
  await manager.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
  await expect(manager.locator('html')).toHaveAttribute('data-theme', 'dark');
  await manager.screenshot({
    path: 'artifacts/manager-mixed-previews-dark.png',
    fullPage: false,
    animations: 'disabled',
  });
  await manager.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
  await manager.evaluate(async () => {
    const database = await new Promise((resolve) => {
      const open = indexedDB.open('tabs-aside-done-right');
      open.onsuccess = () => resolve(open.result);
    });
    const write = database.transaction(['tabs', 'screenshots'], 'readwrite');
    for (let index = 0; index < 6; index++) {
      write.objectStore('tabs').delete(`placeholder-${index}`);
      write.objectStore('screenshots').delete(`placeholder-${index}`);
    }
    await new Promise((resolve) => {
      write.oncomplete = resolve;
    });
    database.close();
  });
  await manager.reload();
  await expect(manager.locator('.tab-card')).toHaveCount(12);
  await manager.locator('.card-preview').first().hover();
  await expect(
    manager
      .locator('.preview-actions')
      .first()
      .getByRole('button', { name: /^Preview / }),
  ).toBeVisible();
  await manager.screenshot({ path: 'artifacts/manager-preview-actions.png', fullPage: false });
  // Fit is a display preference: it leaves all original screenshot blobs untouched.
  const imageMetadata = (await read('screenshots')).map((image) => [
    image.tabId,
    image.width,
    image.height,
    image.bytes,
  ]);
  await manager.getByRole('button', { name: 'Settings', exact: true }).click();
  await manager.getByLabel('Card screenshots', { exact: true }).selectOption('contain');
  await manager.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(manager.locator('.app-shell')).toHaveAttribute('data-preview-fit', 'contain');
  expect(
    await manager
      .locator('.preview-hit > img')
      .first()
      .evaluate((image) => getComputedStyle(image).objectFit),
  ).toBe('contain');
  await manager.screenshot({ path: 'artifacts/manager-fit-images.png', fullPage: false });
  expect(
    (await read('screenshots')).map((image) => [
      image.tabId,
      image.width,
      image.height,
      image.bytes,
    ]),
  ).toEqual(imageMetadata);
  await manager.getByRole('button', { name: 'Settings', exact: true }).click();
  await manager.getByLabel('Card screenshots', { exact: true }).selectOption('cover');
  await manager.getByRole('button', { name: 'Done', exact: true }).click();
  const portrait = manager.locator('.tab-card').filter({
    has: manager.getByRole('heading', { name: 'Portrait monitor example', exact: true }),
  });
  await portrait.locator('.card-preview').hover();
  await portrait
    .getByRole('button', { name: 'Preview Portrait monitor example', exact: true })
    .click();
  await expect(manager.locator('dialog img')).toBeVisible();
  expect(
    await manager
      .locator('dialog img')
      .evaluate((image) => image.naturalWidth / image.naturalHeight),
  ).toBe(0.5);
  expect(
    await manager.locator('dialog img').evaluate((image) => getComputedStyle(image).objectFit),
  ).toBe('contain');
  await manager.getByRole('button', { name: 'Done', exact: true }).click();
  await send({ type: 'DELETE', ids: galleryIds });
  await expect(manager.locator('.tab-card')).toHaveCount(3);
  await manager.setViewportSize({ width: 1440, height: 960 });

  // Menu moves, native drag/drop, and selected-tab moves share the same atomic path.
  const originalSessionId = saved[0].sessionId;
  const moveFixtureIds = await manager.evaluate(async () => {
    const open = indexedDB.open('tabs-aside-done-right');
    const database = await new Promise((resolve) => {
      open.onsuccess = () => resolve(open.result);
    });
    const tx = database.transaction(['tabs', 'screenshots']);
    const tabRequest = tx.objectStore('tabs').getAll();
    const imageRequest = tx.objectStore('screenshots').getAll();
    const [tabs, images] = await Promise.all([
      new Promise((resolve) => {
        tabRequest.onsuccess = () => resolve(tabRequest.result);
      }),
      new Promise((resolve) => {
        imageRequest.onsuccess = () => resolve(imageRequest.result);
      }),
    ]);
    const template = tabs[0],
      image = images.find((image) => image.tabId === template.id);
    const write = database.transaction(['sessions', 'tabs', 'screenshots'], 'readwrite');
    const fixture = [
      ['move-source', 'Move source', 'move-menu-tab', 'Move me by menu'],
      ['move-destination', 'Move destination', 'move-anchor-tab', 'Destination anchor'],
      ['drag-destination', 'Drag destination', 'drag-anchor-tab', 'Drag anchor'],
    ];
    fixture.forEach(([sessionId, name, id, title], index) => {
      write.objectStore('sessions').put({
        id: sessionId,
        name,
        createdAt: Date.now() + 10000 - index * 1000,
        favorite: false,
      });
      write.objectStore('tabs').put({ ...template, id, sessionId, title, index: 0, position: 0 });
      write.objectStore('screenshots').put({ ...image, tabId: id });
    });
    await new Promise((resolve) => {
      write.oncomplete = resolve;
    });
    database.close();
    return fixture.map((item) => item[2]);
  });
  await manager.reload();
  const imageCountBeforeMoves = (await read('screenshots')).length;
  await manager.getByLabel('Actions for Move me by menu', { exact: true }).focus();
  await manager.getByLabel('Actions for Move me by menu', { exact: true }).press('Enter');
  await manager.getByRole('button', { name: 'Move to session…', exact: true }).press('Enter');
  await expect(manager.getByLabel('Destination session')).toBeFocused();
  await manager.getByLabel('Destination session').selectOption('move-destination');
  await manager.screenshot({ path: 'artifacts/manager-move-dialog.png', fullPage: false });
  await manager.getByRole('button', { name: 'Move tabs', exact: true }).click();
  await expect
    .poll(async () => (await read('tabs')).find((tab) => tab.id === 'move-menu-tab')?.sessionId)
    .toBe('move-destination');
  expect((await read('sessions')).some((session) => session.id === 'move-source')).toBe(false);
  expect((await read('screenshots')).length).toBe(imageCountBeforeMoves);
  // Explicit end drops reorder the current session; header drops keep its order.
  const reorderSession = manager.getByRole('region', { name: 'Move destination', exact: true });
  for (const layout of ['Card', 'List']) {
    await manager.getByRole('button', { name: `${layout} view`, exact: true }).click();
    const cards = reorderSession.locator('.tab-card');
    const originalIds = await cards.evaluateAll((items) => items.map((item) => item.dataset.tabId));
    const last = cards.last();
    const box = await last.boundingBox();
    await cards
      .first()
      .locator('.tab-drag-handle')
      .dragTo(last, {
        targetPosition:
          layout === 'Card'
            ? { x: box.width - 4, y: box.height / 2 }
            : { x: box.width / 2, y: box.height - 4 },
      });
    const expectedIds = [originalIds[1], originalIds[0]];
    await expect
      .poll(() => cards.evaluateAll((items) => items.map((item) => item.dataset.tabId)))
      .toEqual(expectedIds);
    await cards
      .first()
      .locator('.tab-drag-handle')
      .dragTo(reorderSession.locator('.session-header'));
    await expect(manager.locator('.toast')).toContainText('Those tabs are already in that order.');
    expect(await cards.evaluateAll((items) => items.map((item) => item.dataset.tabId))).toEqual(
      expectedIds,
    );
  }
  await manager.getByRole('button', { name: 'Card view', exact: true }).click();
  const movedCard = manager
    .locator('.tab-card')
    .filter({ has: manager.getByRole('heading', { name: 'Move me by menu', exact: true }) });
  const dragTarget = manager.getByRole('region', { name: 'Drag destination', exact: true });
  await manager.getByRole('button', { name: 'Collapse Drag destination', exact: true }).click();
  await movedCard.hover();
  await movedCard.locator('.tab-drag-handle').dragTo(dragTarget.locator('.session-header'));
  await expect
    .poll(async () => (await read('tabs')).find((tab) => tab.id === 'move-menu-tab')?.sessionId)
    .toBe('drag-destination');
  await expect(
    manager.getByRole('button', { name: 'Collapse Drag destination', exact: true }),
  ).toHaveAttribute('aria-expanded', 'true');
  expect((await read('sessions')).some((session) => session.id === 'move-destination')).toBe(true);
  // Dragging a selected card moves the whole selection, preserving the same screenshot IDs.
  await manager.getByRole('checkbox', { name: 'Select Move me by menu', exact: true }).check();
  await manager.getByRole('checkbox', { name: 'Select Drag anchor', exact: true }).check();
  await movedCard.hover();
  await movedCard
    .locator('.tab-drag-handle')
    .dragTo(
      manager
        .getByRole('region', { name: 'Move destination', exact: true })
        .locator('.session-header'),
    );
  await expect
    .poll(
      async () => (await read('tabs')).filter((tab) => tab.sessionId === 'move-destination').length,
    )
    .toBe(3);
  expect((await read('sessions')).some((session) => session.id === 'drag-destination')).toBe(false);
  for (const title of ['Move me by menu', 'Destination anchor', 'Drag anchor'])
    await manager.getByRole('checkbox', { name: `Select ${title}`, exact: true }).check();
  await manager
    .locator('.selection-toolbar')
    .getByRole('button', { name: 'Move to session…', exact: true })
    .click();
  await manager.getByLabel('Destination session').selectOption(originalSessionId);
  await manager.getByRole('button', { name: 'Move tabs', exact: true }).click();
  await expect.poll(async () => (await read('sessions')).length).toBe(1);
  expect((await read('tabs')).every((tab) => tab.sessionId === originalSessionId)).toBe(true);
  expect((await read('screenshots')).length).toBe(imageCountBeforeMoves);
  await send({ type: 'DELETE', ids: moveFixtureIds });
  await expect(manager.locator('.tab-card')).toHaveCount(3);
  expect((await read('screenshots')).length).toBe(3);

  // Open is independent of restore-and-remove, and never modifies saved data or jobs.
  const verifyOpen = async (title, expectedUrl) => {
    const beforeOpen = await Promise.all(['tabs', 'sessions', 'jobs'].map(read));
    const beforeImages = (await read('screenshots')).map(({ blob, ...metadata }) => metadata);
    const openedPage = context.waitForEvent('page');
    await manager
      .getByRole('button', { name: `Open ${title} without removing`, exact: true })
      .click();
    const opened = await openedPage;
    await expect(opened).toHaveURL(expectedUrl);
    const active = await worker.evaluate(async () =>
      (await chrome.tabs.query({ active: true })).map((tab) => tab.url),
    );
    expect(active).toContain(expectedUrl);
    expect(await Promise.all(['tabs', 'sessions', 'jobs'].map(read))).toEqual(beforeOpen);
    expect((await read('screenshots')).map(({ blob, ...metadata }) => metadata)).toEqual(
      beforeImages,
    );
    await opened.close();
    await manager.bringToFront();
  };
  await expect(manager.getByRole('checkbox', { name: 'Remove after restoring' })).toBeChecked();
  await verifyOpen('A quiet moment', `${base}/video`);
  await expect(manager.locator('.tab-card')).toHaveCount(3);
  await manager.getByRole('button', { name: 'List view', exact: true }).click();
  await verifyOpen('A quiet moment', `${base}/video`);
  await expect(manager.locator('.list-card')).toHaveCount(3);
  await manager.getByRole('button', { name: 'Card view', exact: true }).click();
  await manager
    .getByRole('button', { name: 'Open A quiet moment without removing', exact: true })
    .hover();
  await manager.screenshot({ path: 'artifacts/manager-open-action.png', fullPage: false });

  // Read-only preview, rename, favorites, searching and layouts.
  const quietPreview = manager.locator('.card-preview').filter({
    has: manager.getByRole('button', { name: 'Enlarge preview of A quiet moment', exact: true }),
  });
  await quietPreview.hover();
  await quietPreview.getByRole('button', { name: 'Preview A quiet moment', exact: true }).click();
  await expect(manager.locator('dialog img')).toBeVisible();
  expect(await read('tabs')).toHaveLength(3);
  await manager.getByRole('button', { name: 'Done', exact: true }).click();
  await manager.locator('.session-title > button').click();
  await manager.getByLabel('Session name').fill('Weekend inspiration');
  await manager.getByRole('button', { name: 'Save name' }).click();
  await expect(manager.locator('.session-title > button')).toHaveText('Weekend inspiration');
  await manager.getByRole('textbox', { name: 'Search tabs and sessions' }).fill('weekend');
  await expect(manager.locator('.tab-card')).toHaveCount(3);
  await manager.getByRole('textbox', { name: 'Search tabs and sessions' }).fill('quiet');
  await expect(manager.locator('.tab-card')).toHaveCount(1);
  await manager.getByRole('button', { name: 'Clear search' }).click();
  await manager.getByRole('button', { name: 'Favorite A quiet moment', exact: true }).click();
  await manager
    .getByRole('navigation', { name: 'Library' })
    .getByRole('button', { name: /Favorites/ })
    .click();
  await expect(manager.locator('.tab-card')).toHaveCount(1);
  await manager
    .getByRole('navigation', { name: 'Library' })
    .getByRole('button', { name: /All tabs/ })
    .click();
  await manager.getByRole('button', { name: 'List view', exact: true }).click();
  await expect(manager.locator('.list-card')).toHaveCount(3);
  await manager.getByRole('button', { name: 'Card view', exact: true }).click();

  // Restore-and-keep, then restore-and-remove: only acknowledged tabs lose images.
  await manager.getByRole('checkbox', { name: 'Remove after restoring' }).uncheck();
  await expect(manager.getByRole('checkbox', { name: 'Remove after restoring' })).not.toBeChecked();
  await quietPreview.hover();
  let previousUpdate = (await read('jobs'))[0].updatedAt;
  await manager
    .getByRole('button', { name: 'Restore A quiet moment from preview', exact: true })
    .click();
  await expect.poll(async () => (await read('jobs'))[0].updatedAt).toBeGreaterThan(previousUpdate);
  await waitDone();
  expect(await read('tabs')).toHaveLength(3);
  expect(await read('screenshots')).toHaveLength(3);
  await manager.getByRole('checkbox', { name: 'Remove after restoring' }).check();
  await expect(manager.getByRole('checkbox', { name: 'Remove after restoring' })).toBeChecked();
  await quietPreview.hover();
  await quietPreview.getByRole('button', { name: 'Preview A quiet moment', exact: true }).click();
  previousUpdate = (await read('jobs'))[0].updatedAt;
  await manager.getByRole('button', { name: 'Restore tab', exact: true }).click();
  await expect.poll(async () => (await read('jobs'))[0].updatedAt).toBeGreaterThan(previousUpdate);
  await waitDone();
  expect(await read('tabs')).toHaveLength(2);
  expect(await read('screenshots')).toHaveLength(2);

  // Mix one invalid record with valid tabs to exercise partial restore retention.
  saved = await read('tabs');
  await manager.evaluate(
    (template) =>
      new Promise((resolve) => {
        const open = indexedDB.open('tabs-aside-done-right');
        open.onsuccess = () => {
          const database = open.result;
          const tx = database.transaction('tabs', 'readwrite');
          tx.objectStore('tabs').put({
            ...template,
            id: 'invalid-fixture',
            url: 'javascript:alert(1)',
            title: 'Invalid fixture',
            preview: 'disabled',
            previewBytes: 0,
          });
          tx.oncomplete = () => {
            database.close();
            resolve();
          };
        };
      }),
    saved[0],
  );
  expect(
    (
      await send({
        type: 'RESTORE',
        ids: [...saved.map((tab) => tab.id), 'invalid-fixture'],
        remove: true,
        newWindow: true,
      })
    ).ok,
  ).toBe(true);
  const restoreJob = await waitDone();
  expect(restoreJob.done).toBe(2);
  expect(restoreJob.failed).toBe(1);
  // Errors remain reviewable even when older than the success-notification timeout.
  await manager.evaluate(
    (job) =>
      new Promise((resolve) => {
        const open = indexedDB.open('tabs-aside-done-right');
        open.onsuccess = () => {
          const database = open.result;
          const tx = database.transaction('jobs', 'readwrite');
          tx.objectStore('jobs').put({ ...job, updatedAt: Date.now() - 60000 });
          tx.oncomplete = () => {
            database.close();
            resolve();
          };
        };
      }),
    restoreJob,
  );
  await manager.bringToFront();
  await manager.reload();
  await expect(manager.locator('.operation.attention')).toBeVisible();
  expect((await read('tabs')).map((tab) => tab.id)).toEqual(['invalid-fixture']);
  expect(await read('screenshots')).toHaveLength(0);

  // Metadata-only save closes a selected source without requiring a screenshot.
  const plain = await context.newPage();
  await plain.goto(`${base}/plain`);
  await plain.bringToFront();
  expect((await send({ type: 'ASIDE', scope: 'current', withoutPreviews: true })).ok).toBe(true);
  await waitDone();
  expect(plain.isClosed()).toBe(true);
  expect(
    (await read('tabs')).some((tab) => tab.url.endsWith('/plain') && tab.preview === 'disabled'),
  ).toBe(true);

  // Fully captured source windows stay open with one active blank tab.
  const captureWindow = await worker.evaluate(async (base) => {
    const window = await chrome.windows.create({
      url: [`${base}/close-one`, `${base}/close-two`],
      type: 'normal',
    });
    return window.id;
  }, base);
  await expect
    .poll(async () =>
      worker.evaluate(async (id) => {
        const tabs = await chrome.tabs.query({ windowId: id });
        return tabs.length === 2 && tabs.every((tab) => tab.status === 'complete');
      }, captureWindow),
    )
    .toBe(true);
  await worker.evaluate((windowId) => {
    globalThis.windowSaveTrace = [];
    globalThis.windowSaveCreated = (tab) => {
      if (tab.windowId === windowId)
        globalThis.windowSaveTrace.push({ type: 'created', id: tab.id });
    };
    globalThis.windowSaveRemoved = (id, info) => {
      if (info.windowId === windowId) globalThis.windowSaveTrace.push({ type: 'removed', id });
    };
    chrome.tabs.onCreated.addListener(globalThis.windowSaveCreated);
    chrome.tabs.onRemoved.addListener(globalThis.windowSaveRemoved);
  }, captureWindow);
  expect((await send({ type: 'ASIDE', scope: 'window', windowId: captureWindow })).ok).toBe(true);
  expect((await waitDone()).done).toBe(2);
  await expect
    .poll(() =>
      worker.evaluate(async (id) => {
        const tabs = await chrome.tabs.query({ windowId: id });
        return tabs.length === 1 && tabs[0].url === 'about:blank' && tabs[0].active;
      }, captureWindow),
    )
    .toBe(true);
  await expect.poll(() => worker.evaluate(() => globalThis.windowSaveTrace.length)).toBe(3);
  const saveTrace = await worker.evaluate(() => {
    chrome.tabs.onCreated.removeListener(globalThis.windowSaveCreated);
    chrome.tabs.onRemoved.removeListener(globalThis.windowSaveRemoved);
    return globalThis.windowSaveTrace;
  });
  expect(saveTrace.map((event) => event.type)).toEqual(['removed', 'created', 'removed']);
  expect(
    await worker.evaluate(
      async () =>
        (await chrome.tabs.query({})).filter((tab) => tab.url?.endsWith('/manager.html')).length,
    ),
  ).toBe(1);

  // Real Chrome-discarded tabs skip activation and show a consistent placeholder frame.
  async function sleepingWindow(prefix) {
    const windowId = await worker.evaluate(
      async ({ base, prefix }) => {
        const window = await chrome.windows.create({
          url: [`${base}/${prefix}-loaded`, `${base}/${prefix}-sleeping`],
          type: 'normal',
        });
        return window.id;
      },
      { base, prefix },
    );
    await expect
      .poll(() =>
        worker.evaluate(async (windowId) => {
          const tabs = await chrome.tabs.query({ windowId });
          return tabs.length === 2 && tabs.every((tab) => tab.status === 'complete');
        }, windowId),
      )
      .toBe(true);
    await worker.evaluate(
      async ({ windowId, prefix }) => {
        const tabs = await chrome.tabs.query({ windowId });
        const loaded = tabs.find((tab) => tab.url.endsWith(`${prefix}-loaded`));
        const sleeping = tabs.find((tab) => tab.url.endsWith(`${prefix}-sleeping`));
        await chrome.tabs.update(loaded.id, { active: true });
        await chrome.tabs.discard(sleeping.id);
      },
      { windowId, prefix },
    );
    await expect
      .poll(() =>
        worker.evaluate(
          async ({ windowId, prefix }) =>
            (await chrome.tabs.query({ windowId })).find((tab) =>
              tab.url.endsWith(`${prefix}-sleeping`),
            )?.discarded,
          { windowId, prefix },
        ),
      )
      .toBe(true);
    return windowId;
  }
  const skippedWindow = await sleepingWindow('skip');
  const beforeSleepCapture = await worker.evaluate(
    (windowId) => chrome.tabs.query({ windowId }),
    skippedWindow,
  );
  const beforeSkip = hits.get('/skip-sleeping');
  expect((await send({ type: 'ASIDE', scope: 'window', windowId: skippedWindow })).ok).toBe(true);
  const skippedJob = await waitDone();
  expect(skippedJob.failed, JSON.stringify({ skippedJob, beforeSleepCapture })).toBe(0);
  const skippedTab = (await read('tabs')).find((tab) => tab.url.endsWith('/skip-sleeping'));
  expect(skippedTab.preview).toBe('skipped');
  expect(skippedTab.closeState).toBe('closed');
  expect((await read('screenshots')).some((image) => image.tabId === skippedTab.id)).toBe(false);
  expect(hits.get('/skip-sleeping')).toBe(beforeSkip);
  await manager.bringToFront();
  await manager.getByRole('textbox', { name: 'Search tabs and sessions' }).fill('/skip-sleeping');
  await expect(manager.locator('.tab-card')).toHaveCount(1);
  await expect(manager.locator('.card-preview')).toHaveCount(1);
  await expect(manager.locator('.preview-placeholder')).toHaveCount(1);
  await manager.screenshot({ path: 'artifacts/manager-sleeping.png', fullPage: false });
  await manager.getByRole('button', { name: 'Clear search' }).click();

  // The opt-in setting really reloads discarded tabs before saving previews.
  await manager.getByRole('button', { name: 'Settings', exact: true }).click();
  const sleepSetting = manager.getByRole('checkbox', {
    name: /Capture previews for sleeping tabs/,
  });
  await expect(sleepSetting).not.toBeChecked();
  await sleepSetting.check();
  await manager.getByRole('button', { name: 'Done', exact: true }).click();
  const wokenWindow = await sleepingWindow('wake');
  const beforeWake = hits.get('/wake-sleeping');
  expect((await send({ type: 'ASIDE', scope: 'window', windowId: wokenWindow })).ok).toBe(true);
  expect((await waitDone()).failed).toBe(0);
  const wokenTab = (await read('tabs')).find((tab) => tab.url.endsWith('/wake-sleeping'));
  expect(wokenTab.preview).toBe('ready');
  expect(wokenTab.closeState).toBe('closed');
  expect((await read('screenshots')).some((image) => image.tabId === wokenTab.id)).toBe(true);
  expect(hits.get('/wake-sleeping')).toBeGreaterThan(beforeWake);

  // Settings, dark theme and confirmed complete deletion.
  await manager.bringToFront();
  await manager.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(
    manager.getByRole('checkbox', { name: /Open manager after saving/ }),
  ).not.toBeChecked();
  await manager.getByRole('checkbox', { name: /Open manager after saving/ }).check();
  await manager.getByLabel('Appearance', { exact: true }).selectOption('dark');
  await manager.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(manager.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(
    await manager.locator('html').evaluate((element) => getComputedStyle(element).backgroundColor),
  ).toBe('rgb(37, 43, 42)');
  const themeButton = await manager
    .getByRole('button', { name: 'Switch to light mode', exact: true })
    .boundingBox();
  const preferencesButton = await manager
    .getByRole('button', { name: 'Open settings', exact: true })
    .boundingBox();
  expect(preferencesButton.x - (themeButton.x + themeButton.width)).toBeGreaterThanOrEqual(0);
  expect(preferencesButton.x - (themeButton.x + themeButton.width)).toBeLessThan(14);
  const themePopup = await context.newPage();
  await themePopup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(themePopup.locator('html')).toHaveAttribute('data-theme', 'dark');
  await themePopup
    .locator('.popup-shell')
    .screenshot({ path: 'artifacts/popup-dark.png', animations: 'disabled' });
  await manager.bringToFront();
  await manager.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
  await expect(manager.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(themePopup.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect
    .poll(() =>
      worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings.theme),
    )
    .toBe('light');
  await manager.reload();
  await expect(manager.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(
    manager.getByRole('button', { name: 'Switch to dark mode', exact: true }),
  ).toBeVisible();
  // System remains available in Preferences; the header toggle overrides the resolved mode.
  await manager.emulateMedia({ colorScheme: 'dark' });
  await themePopup.emulateMedia({ colorScheme: 'dark' });
  await manager.getByRole('button', { name: 'Open settings', exact: true }).click();
  await manager.getByLabel('Appearance', { exact: true }).selectOption('system');
  await manager.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(manager.locator('html')).toHaveAttribute('data-theme', 'dark');
  await manager.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
  await expect(manager.locator('html')).toHaveAttribute('data-theme', 'light');
  await manager.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
  await expect(manager.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(themePopup.locator('html')).toHaveAttribute('data-theme', 'dark');
  await themePopup.close();
  await manager.screenshot({
    path: 'artifacts/manager-dark.png',
    fullPage: true,
    animations: 'disabled',
  });
  await manager.getByRole('button', { name: 'Settings', exact: true }).click();
  await manager.getByRole('button', { name: /Delete all saved data/ }).click();
  await manager.getByRole('button', { name: 'Delete everything saved', exact: true }).click();
  await expect(manager.locator('dialog')).toHaveCount(0);
  expect(await read('tabs')).toHaveLength(0);
  expect(await read('screenshots')).toHaveLength(0);
  expect(await read('sessions')).toHaveLength(0);

  // Import migration data through the real file picker; never read private sample files here.
  const migration = {
    local: {
      collections: [
        {
          type: 'collection',
          title: 'Imported research',
          timestamp: 1700000000000,
          items: [
            { type: 'tab', title: 'Migration overview', url: `${base}/import-overview` },
            {
              type: 'group',
              title: 'Migration group',
              color: 'purple',
              items: [
                { type: 'tab', title: 'Migration A', url: `${base}/import-a` },
                { type: 'tab', title: 'Migration B', url: `${base}/import-b` },
                {
                  type: 'tab',
                  title: 'Other extension settings',
                  url: 'chrome-extension://other/options.html',
                },
              ],
            },
          ],
        },
      ],
    },
    sync: { analytics: true },
  };
  const upload = (data) =>
    manager.locator('input[type=file]').setInputFiles({
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(data)),
    });
  await manager.getByRole('button', { name: 'Import sessions', exact: true }).click();
  await upload({ unrelated: true });
  await expect(manager.getByRole('alert')).toContainText('Unrecognized backup');
  expect(await read('tabs')).toHaveLength(0);
  await upload(migration);
  await expect(manager.getByRole('dialog').getByText('Tabs Aside', { exact: true })).toBeVisible();
  await expect(manager.getByText(/1 tab with missing or unsupported addresses/)).toBeVisible();
  await manager.locator('.import-session summary').click();
  await expect(manager.getByText('Migration A', { exact: true })).toBeVisible();
  await manager.screenshot({ path: 'artifacts/import-preview.png', fullPage: false });
  await manager.getByRole('button', { name: 'Import 1 session · 3 tabs', exact: true }).click();
  await expect(manager.locator('dialog')).toHaveCount(0);
  await expect(manager.locator('.tab-card')).toHaveCount(3);
  await expect(manager.locator('.card-preview')).toHaveCount(3);
  await expect(manager.locator('.preview-placeholder')).toHaveCount(3);
  expect(await read('screenshots')).toHaveLength(0);
  expect(hits.get('/import-a')).toBeUndefined();
  const imported = await read('tabs');
  expect(imported.filter((t) => t.group?.title === 'Migration group')).toHaveLength(2);
  await manager.screenshot({ path: 'artifacts/imported-sessions.png', fullPage: false });
  await verifyOpen('Migration A', `${base}/import-a`);
  await expect(manager.locator('.tab-card')).toHaveCount(3);
  await expect(manager.locator('.preview-placeholder')).toHaveCount(3);
  await manager.getByRole('button', { name: 'Import sessions', exact: true }).click();
  await upload(migration);
  await expect(
    manager.getByText(/Some sessions from this file were already imported/),
  ).toBeVisible();
  await expect(
    manager.getByRole('button', { name: 'Import 0 sessions · 0 tabs', exact: true }),
  ).toBeDisabled();
  await manager.getByRole('checkbox', { name: 'Import these sessions again', exact: true }).check();
  await expect(
    manager.getByRole('button', { name: 'Import 1 session · 3 tabs', exact: true }),
  ).toBeEnabled();
  await manager.getByRole('button', { name: 'Cancel', exact: true }).click();
  // Restoring an imported session recreates actual Chrome tab groups.
  await manager.getByRole('checkbox', { name: 'Remove after restoring' }).uncheck();
  const managerWindowId = await manager.evaluate(
    async () => (await chrome.windows.getCurrent()).id,
  );
  const beforeSessionRestore = await worker.evaluate(async () =>
    (await chrome.tabs.query({})).map((tab) => ({ id: tab.id, windowId: tab.windowId })),
  );
  const previousRestore = (await read('jobs'))[0]?.updatedAt ?? 0;
  await manager.getByRole('button', { name: 'Restore 3', exact: true }).click();
  await expect
    .poll(async () => (await read('jobs'))[0]?.updatedAt)
    .toBeGreaterThan(previousRestore);
  expect((await waitDone()).failed).toBe(0);
  const restoredGroup = await worker.evaluate(async () => {
    const groups = await chrome.tabGroups.query({ title: 'Migration group' });
    const group = groups[0];
    return { group, tabs: await chrome.tabs.query({ groupId: group.id }) };
  });
  expect(restoredGroup.group.color).toBe('purple');
  expect(restoredGroup.tabs).toHaveLength(2);
  expect(restoredGroup.group.windowId).not.toBe(managerWindowId);
  expect(beforeSessionRestore.some((tab) => tab.windowId === restoredGroup.group.windowId)).toBe(
    false,
  );
  const sessionWindowTabs = await worker.evaluate(
    (id) => chrome.tabs.query({ windowId: id }),
    restoredGroup.group.windowId,
  );
  expect(sessionWindowTabs).toHaveLength(3);
  expect(sessionWindowTabs.some((tab) => tab.url === 'about:blank')).toBe(false);
  await worker.evaluate((id) => chrome.windows.remove(id), restoredGroup.group.windowId);
  await manager.bringToFront();
  await manager.getByRole('button', { name: 'Settings', exact: true }).click();
  const downloaded = manager.waitForEvent('download');
  await manager.getByRole('button', { name: /Export a URL backup/ }).click();
  const nativeBackup = JSON.parse(readFileSync(await (await downloaded).path(), 'utf8'));
  expect(nativeBackup.format).toBe('tabs-on-hold');
  expect(nativeBackup.includesScreenshots).toBe(false);
  expect(nativeBackup.tabs.every((t) => !('sourceTabId' in t) && !('preview' in t))).toBe(true);
  await manager.getByRole('button', { name: 'Done', exact: true }).click();
  await manager.getByRole('button', { name: 'Import sessions', exact: true }).click();
  await upload(nativeBackup);
  await expect(
    manager.getByRole('dialog').getByText('Tabs on Hold', { exact: true }),
  ).toBeVisible();
  await manager.getByRole('button', { name: 'Import 1 session · 3 tabs', exact: true }).click();
  await expect(manager.locator('dialog')).toHaveCount(0);
  expect(await read('sessions')).toHaveLength(2);
  expect(new Set((await read('tabs')).map((t) => t.id)).size).toBe(6);
  await manager.getByRole('button', { name: 'Import sessions', exact: true }).click();
  await upload({
    version: '1.0',
    exportedAt: new Date().toISOString(),
    sessions: [
      {
        id: 'external-a',
        name: 'Choose work',
        createdAt: 1700000000000,
        tabs: [{ title: 'Work', url: `${base}/work`, pinned: true, windowId: 1, index: 0 }],
      },
      {
        id: 'external-b',
        name: 'Skip personal',
        createdAt: 1700000000001,
        tabs: [{ title: 'Personal', url: `${base}/personal` }],
      },
    ],
  });
  await expect(manager.getByText('Tab Session Manager', { exact: true })).toBeVisible();
  await manager.getByRole('checkbox', { name: 'Import Skip personal', exact: true }).uncheck();
  await manager.getByRole('button', { name: 'Import 1 session · 1 tab', exact: true }).click();
  await expect(manager.locator('dialog')).toHaveCount(0);
  expect(await read('sessions')).toHaveLength(3);
  expect((await read('tabs')).find((t) => t.title === 'Work').pinned).toBe(true);
  expect((await read('tabs')).some((t) => t.title === 'Personal')).toBe(false);
  await send({ type: 'CLEAR' });
  expect(await read('imports')).toHaveLength(0);

  // A 1,000-tab collection stays searchable without mounting every card or image.
  await manager.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open('tabs-aside-done-right');
        open.onsuccess = () => {
          const database = open.result;
          const tx = database.transaction(['sessions', 'tabs'], 'readwrite');
          for (let s = 0; s < 50; s++) {
            tx.objectStore('sessions').put({
              id: `scale-${s}`,
              name: `Research ${s}`,
              createdAt: Date.now() - s * 60000,
              favorite: false,
            });
            for (let i = 0; i < 20; i++)
              tx.objectStore('tabs').put({
                id: `scale-${s}-${i}`,
                sessionId: `scale-${s}`,
                title: `Research paper ${s}-${i}`,
                url: `https://example.com/research/${s}/${i}`,
                domain: 'example.com',
                createdAt: Date.now() - s * 60000,
                index: i,
                windowId: 1,
                pinned: false,
                muted: false,
                favorite: false,
                preview: 'disabled',
                closeState: 'closed',
              });
          }
          tx.oncomplete = () => {
            database.close();
            resolve();
          };
        };
      }),
  );
  await manager.reload();
  // Sessions show every tab by default. Optional limits expose counts and persist.
  await expect(manager.locator('.tab-card')).toHaveCount(1000, { timeout: 10000 });
  await expect(manager.locator('.show-more-controls')).toHaveCount(0);
  const researchSession = manager.locator('.session').filter({
    has: manager.getByRole('button', { name: 'Research 0', exact: true }),
  });
  await expect(researchSession.locator('.tab-card')).toHaveCount(20);
  await manager.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(manager.getByLabel('Tabs shown per session', { exact: true })).toHaveValue('0');
  await manager.getByLabel('Tabs shown per session', { exact: true }).selectOption('12');
  await manager.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(researchSession.locator('.tab-card')).toHaveCount(12);
  await expect(researchSession.locator('.tab-visibility-note')).toHaveText(
    'Showing 12 of 20 tabs · 8 tabs hidden',
  );
  await researchSession.getByRole('button', { name: 'Show remaining 8 tabs', exact: true }).click();
  await expect(researchSession.locator('.tab-card')).toHaveCount(20);
  await expect(researchSession.locator('.show-more-controls')).toHaveCount(0);
  await manager.reload();
  await expect(researchSession.locator('.tab-card')).toHaveCount(12);
  await manager.screenshot({ path: 'artifacts/session-tab-limit.png', fullPage: false });
  await manager.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(manager.getByLabel('Tabs shown per session', { exact: true })).toHaveValue('12');
  await manager.getByLabel('Tabs shown per session', { exact: true }).selectOption('0');
  await manager.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(manager.locator('.tab-card')).toHaveCount(1000, { timeout: 10000 });
  await expect(researchSession.locator('.tab-card')).toHaveCount(20);
  await manager
    .getByRole('navigation', { name: 'Library' })
    .getByRole('button', { name: /All tabs/ })
    .click();
  await expect(manager.locator('.tab-card')).toHaveCount(60);
  await expect(manager.locator('.tab-visibility-note')).toHaveText(
    'Showing 60 of 1,000 tabs · 940 tabs hidden',
  );
  await manager.getByRole('button', { name: 'Show next 60 tabs', exact: true }).click();
  await expect(manager.locator('.tab-card')).toHaveCount(120);
  await manager.getByRole('button', { name: 'Show all 1,000 tabs', exact: true }).click();
  await expect(manager.locator('.tab-card')).toHaveCount(1000, { timeout: 10000 });
  await expect(manager.locator('.show-more-controls')).toHaveCount(0);
  await manager.getByRole('textbox', { name: 'Search tabs and sessions' }).fill('paper 49-19');
  await expect(manager.locator('.tab-card')).toHaveCount(1);
  await expect(manager.locator('.card-copy h3')).toHaveText('Research paper 49-19');
  await manager.getByRole('button', { name: 'Clear search' }).click();
  await manager.setViewportSize({ width: 760, height: 900 });
  await expect
    .poll(() => manager.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await manager.screenshot({ path: 'artifacts/manager-narrow.png', fullPage: false });
  await send({ type: 'CLEAR' });
  expect(await read('tabs')).toHaveLength(0);
  expect(await read('screenshots')).toHaveLength(0);
  expect(errors).toEqual([]);
  const keptWindowTabs = await worker.evaluate(
    (id) => chrome.tabs.query({ windowId: id }),
    captureWindow,
  );
  expect(keptWindowTabs).toHaveLength(1);
  expect(keptWindowTabs[0]).toMatchObject({ url: 'about:blank', active: true });
  console.log(
    'Browser smoke passed: charcoal and sage dark palette, header theme toggle beside preferences, theme persistence and popup sync, system theme override, timed success notifications, stale-result hiding, persistent errors, outside-click/Escape/action menu dismissal, real viewport/video capture, pinned exclusion, persistent blobs, mixed-monitor previews, keyboard menu moves, native single/bulk drag moves, bulk destination picker, empty-session cleanup, search, favorites, list view, restore keep/remove, partial restore, sleeping-tab skip/wake, complete deletion, 1,000-tab search and batching, narrow layout.',
  );
  console.log(`Screenshot sizes: ${imageInfo.map((image) => image.bytes + ' B').join(', ')}`);
} finally {
  await context.close();
  await new Promise((resolve) => server.close(resolve));
}
