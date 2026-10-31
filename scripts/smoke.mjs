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
  await expect(manager.locator('.card-preview img')).toHaveCount(3);
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
  await expect(manager.locator('.card-preview img')).toHaveCount(12);
  const monitorShapes = await manager
    .locator('.card-preview img')
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
      .locator('.card-preview img')
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
      .locator('.card-preview img')
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

  // Fully captured source windows close without creating a manager in them.
  const captureWindow = await worker.evaluate(async (base) => {
    const window = await chrome.windows.create({
      url: [`${base}/close-one`, `${base}/close-two`, chrome.runtime.getURL('/manager.html')],
      type: 'normal',
    });
    return window.id;
  }, base);
  await expect
    .poll(async () =>
      worker.evaluate(async (id) => {
        const tabs = await chrome.tabs.query({ windowId: id });
        return tabs.length === 3 && tabs.every((tab) => tab.status === 'complete');
      }, captureWindow),
    )
    .toBe(true);
  expect((await send({ type: 'ASIDE', scope: 'window', windowId: captureWindow })).ok).toBe(true);
  expect((await waitDone()).done).toBe(2);
  await expect
    .poll(() =>
      worker.evaluate(async (id) => {
        try {
          await chrome.windows.get(id);
          return false;
        } catch {
          return true;
        }
      }, captureWindow),
    )
    .toBe(true);
  expect(
    await worker.evaluate(
      async () =>
        (await chrome.tabs.query({})).filter((tab) => tab.url?.endsWith('/manager.html')).length,
    ),
  ).toBe(1);

  // Real Chrome-discarded tabs skip activation and show a placeholder by default.
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
  await expect(manager.getByText('Sleeping tab · preview skipped', { exact: true })).toBeVisible();
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
  ).toBe('rgb(9, 9, 11)');
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
  await themePopup.locator('.popup-shell').screenshot({ path: 'artifacts/popup-dark.png' });
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
  await manager.screenshot({ path: 'artifacts/manager-dark.png', fullPage: true });
  await manager.getByRole('button', { name: 'Settings', exact: true }).click();
  await manager.getByRole('button', { name: /Delete all saved data/ }).click();
  await manager.getByRole('button', { name: 'Delete everything saved', exact: true }).click();
  await expect(manager.locator('dialog')).toHaveCount(0);
  expect(await read('tabs')).toHaveLength(0);
  expect(await read('screenshots')).toHaveLength(0);
  expect(await read('sessions')).toHaveLength(0);

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
  await manager
    .getByRole('navigation', { name: 'Library' })
    .getByRole('button', { name: /All tabs/ })
    .click();
  await expect(manager.locator('.tab-card')).toHaveCount(60);
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
  console.log(
    'Browser smoke passed: zinc dark palette, header theme toggle beside preferences, theme persistence and popup sync, system theme override, timed success notifications, stale-result hiding, persistent errors, outside-click/Escape/action menu dismissal, real viewport/video capture, pinned exclusion, persistent blobs, mixed-monitor previews, keyboard menu moves, native single/bulk drag moves, bulk destination picker, empty-session cleanup, search, favorites, list view, restore keep/remove, partial restore, sleeping-tab skip/wake, complete deletion, 1,000-tab search and batching, narrow layout.',
  );
  console.log(`Screenshot sizes: ${imageInfo.map((image) => image.bytes + ' B').join(', ')}`);
} finally {
  await context.close();
  await new Promise((resolve) => server.close(resolve));
}
