const { test, expect } = require('@playwright/test');
const { spawn } = require('child_process');
const path = require('path');

// Served over http on its own port: a service worker cannot run from file://.
const PORT = 4173 + Math.floor(Math.random() * 500);
let server;
test.beforeAll(async () => {
  server = spawn(process.execPath, [path.join(__dirname, 'serve.js'), String(PORT)], { stdio: 'pipe' });
  await new Promise((r) => server.stdout.once('data', r));
});
test.afterAll(() => server && server.kill());

test('with no signal, the folder address still opens the app from cache', async ({ page, context }) => {
  // Phones open https://titanalaska.github.io/<app>/ -- the folder, not index.html.
  await page.route((u) => u.href.includes('script.google.com'), (route) => route.abort());
  await page.goto('http://localhost:' + PORT + '/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForTimeout(300);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('header h1')).toHaveText('Plow Command');
  await expect(page.locator('main')).toContainText("Couldn't reach the server");
  await context.setOffline(false);
});

test('the shell is cached, Apps Script never is, and other apps\' caches survive', async ({ page }) => {
  // Same origin carries every titanalaska app: the plow worker must never delete their caches.
  await page.route((u) => u.href.includes('script.google.com'), (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'signin', reason: 'Sign in', version: 'pairings-1' }) }));
  await page.goto('http://localhost:' + PORT + '/index.html');
  await page.evaluate(async () => { await caches.open('wolf-beds-v2'); await caches.open('groundwork-shell-v34'); await caches.open('titan-plow-shell-1'); await caches.open('titan-plow-shell-2'); await caches.open('titan-plow-shell-3'); await caches.open('titan-plow-shell-4'); await caches.open('titan-plow-shell-6'); await caches.open('titan-plow-shell-7'); await caches.open('titan-plow-shell-8'); await caches.open('titan-plow-shell-9'); await caches.open('titan-plow-shell-10'); await caches.open('titan-plow-shell-11'); await caches.open('titan-plow-shell-12'); await caches.open('titan-plow-shell-13'); await caches.open('titan-plow-shell-14'); await caches.open('titan-plow-shell-15'); await caches.open('titan-plow-shell-17'); await caches.open('titan-plow-shell-18'); await caches.open('titan-plow-shell-19'); await caches.open('titan-plow-shell-20'); await caches.open('titan-plow-shell-21'); await caches.open('titan-plow-shell-22'); await caches.open('titan-plow-shell-23'); await caches.open('titan-plow-shell-24'); await caches.open('titan-plow-shell-25'); await caches.open('titan-plow-shell-40'); });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(500);
  const state = await page.evaluate(async () => {
    const names = await caches.keys();
    const shell = await caches.open('titan-plow-shell-5');
    const urls = (await shell.keys()).map((r) => r.url);
    return { names, urls };
  });
  expect(state.names).toContain('titan-plow-shell-5');
  expect(state.names).toContain('wolf-beds-v2');
  expect(state.names).toContain('groundwork-shell-v34');
  expect(state.names).not.toContain('titan-plow-shell-1');          // its own old versions are cleaned up (shell 1 was live until 10/22/26)
  expect(state.names).not.toContain('titan-plow-shell-2');
  expect(state.names).not.toContain('titan-plow-shell-3');
  expect(state.names).not.toContain('titan-plow-shell-4');
  expect(state.names).not.toContain('titan-plow-shell-6');
  expect(state.names).not.toContain('titan-plow-shell-7');
  expect(state.names).not.toContain('titan-plow-shell-8');
  expect(state.names).not.toContain('titan-plow-shell-9');
  expect(state.names).not.toContain('titan-plow-shell-10');
  expect(state.names).not.toContain('titan-plow-shell-11');
  expect(state.names).not.toContain('titan-plow-shell-12');
  expect(state.names).not.toContain('titan-plow-shell-13');
  expect(state.names).not.toContain('titan-plow-shell-14');
  expect(state.names).not.toContain('titan-plow-shell-15');
  expect(state.names).not.toContain('titan-plow-shell-17');
  expect(state.names).not.toContain('titan-plow-shell-18');
  expect(state.names).not.toContain('titan-plow-shell-19');
  expect(state.names).not.toContain('titan-plow-shell-20');
  expect(state.names).not.toContain('titan-plow-shell-21');
  expect(state.names).not.toContain('titan-plow-shell-22');
  expect(state.names).not.toContain('titan-plow-shell-23');
  expect(state.names).not.toContain('titan-plow-shell-24');
  expect(state.names).not.toContain('titan-plow-shell-25');
  expect(state.names).not.toContain('titan-plow-shell-16');
  expect(state.names).not.toContain('titan-plow-shell-40');
  // The map pieces are in the shell, so a map opens with no signal (zones only, no photo). Plow Command has no
  // points or kept-outlines files (Task 13): the zones come with the sign-in.
  for (const f of ['/vendor/maplibre-gl.js', '/vendor/maplibre-gl.css', '/lib/geo.js', '/lib/mapview.js', '/lib/bpimport.js', '/lib/mapedit.js',
    '/lib/time.js', '/lib/board.js', '/lib/history.js', '/lib/warnings.js', '/lib/pairing.js', '/lib/boardui.js',
    '/lib/shiftlog.js', '/lib/routesheet.js', '/lib/handoff.js', '/lib/shiftlogui.js', '/lib/es.js', '/lib/weather.js', '/lib/callout.js', '/lib/share.js', '/lib/pull.js', '/manifest.json', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png']) {
    expect(state.urls.some((u) => u.endsWith(f)), f).toBe(true);
  }
  expect(state.urls.some((u) => u.endsWith('/lib/app.js'))).toBe(true);
  // Plow Command has no Gear log (Task 17): its file is gone, and so is its place in the shell (addAll of a missing file would fail the install).
  expect(state.urls.some((u) => u.endsWith('/lib/gear.js'))).toBe(false);
  for (const name of state.names) {
    const urls = await page.evaluate(async (n) => (await (await caches.open(n)).keys()).map((r) => r.url), name);
    expect(urls.filter((u) => u.includes('script.google.com'))).toEqual([]);
  }
});

test('activating this worker deletes its own old shell cache and leaves Shovel Command\'s titan-snow-shell-41 alone', async ({ page }) => {
  // One origin, one Cache API: a driver who also has Shovel Command installed has its shell cache right
  // beside ours. Both are made BEFORE this worker exists (on a page that does not register it), so the
  // activate step is what meets them: titan-plow-shell-0 is ours and old -> gone; titan-snow-shell-41 is
  // Shovel Command's current shell -> must survive; the current titan-plow-shell-5 is there.
  await page.route((u) => u.href.includes('script.google.com'), (route) => route.abort());
  await page.goto('http://localhost:' + PORT + '/lib/config.js'); // same origin, no service worker registered
  await page.evaluate(async () => { await caches.open('titan-snow-shell-41'); await caches.open('titan-plow-shell-0'); });
  await page.goto('http://localhost:' + PORT + '/index.html');
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    if (reg.active.state !== 'activated') await new Promise((done) => reg.active.addEventListener('statechange', () => { if (reg.active.state === 'activated') done(); }));
  });
  const names = await page.evaluate(() => caches.keys());
  expect(names).toContain('titan-snow-shell-41');
  expect(names).not.toContain('titan-plow-shell-0');
  expect(names).toContain('titan-plow-shell-5');
});

test('aerial photo tiles pass straight through and are never cached', async ({ page }) => {
  // MOA and Esri tiles are other origins: the worker must not keep them (they'd
  // fill the phone, and a stale photo is worse than none).
  await page.route((u) => u.href.includes('script.google.com'), (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'signin', reason: 'Sign in', version: 'pairings-1' }) }));
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  await page.route((u) => /ancgis\.com|arcgisonline\.com/.test(u.href), (route) => route.fulfill({ contentType: 'image/png', body: PNG }));
  await page.goto('http://localhost:' + PORT + '/index.html');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);
  const ok = await page.evaluate(async () => {
    const a = await fetch('https://www.ancgis.com/arcgis/rest/services/imagery_public/Photo_2024/MapServer/tile/18/76543/12345');
    const b = await fetch('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/18/76543/12345');
    return a.ok && b.ok && !!navigator.serviceWorker.controller;
  });
  expect(ok).toBe(true); // the tiles really went through a page the worker controls
  await page.waitForTimeout(300);
  const tiles = await page.evaluate(async () => {
    const out = [];
    for (const n of await caches.keys()) for (const r of await (await caches.open(n)).keys()) if (/ancgis|arcgisonline/.test(r.url)) out.push(n + ' ' + r.url);
    return out;
  });
  expect(tiles).toEqual([]);
});
