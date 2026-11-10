// Low quality through the menus (M8 phase C): with Low stored, the title's match and a Quick match draw the people's half-size
// atlases (asset.ts prepareLow), so the textures stay inside Low's 256 MB budget. Prints each, then PASS/FAIL.
//   bash tools/one-chrome.sh node tools/low-check.mjs [url]   (the dev server: npx vite --port 5190)
import puppeteer from 'puppeteer-core';
const url = process.argv[2] ?? 'http://localhost:5190/';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal'] });
let ok = true;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' || /half-size|not loaded/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('bandeja.settings.v1', JSON.stringify({ quality: 'low', setup: { mode: 'doubles', length: 'short' } })); } catch { /* none */ } });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__app?.menu?.isOpen && window.__bandeja?.running, { timeout: 180000, polling: 200 });
  const mem = () => page.evaluate(() => ({ tex: window.__bandeja.renderer.info.memory.texturesSize / 1048576, preset: window.__bandeja.preset?.name }));
  const t = await mem();
  console.log(`title: ${t.preset}, textures ${t.tex.toFixed(0)} MB`);
  if (t.preset !== 'Low' || t.tex > 256) ok = false;
  await page.evaluate(() => { window.__before = window.__bandeja; });
  await page.evaluate(() => [...document.querySelectorAll('#menu.on .item')].find((x) => x.textContent.trim().startsWith('Quick match'))?.click());
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => [...document.querySelectorAll('#menu.on .item')].find((x) => x.textContent.trim().startsWith('Start match'))?.click());
  await page.waitForFunction(() => window.__bandeja !== window.__before && window.__bandeja.running && !window.__app.menu.isOpen, { timeout: 180000, polling: 250 });
  await new Promise((r) => setTimeout(r, 4000));
  const m = await mem();
  console.log(`match: ${m.preset}, textures ${m.tex.toFixed(0)} MB, players ${await page.evaluate(() => window.__bandeja.players.length)}`);
  if (m.preset !== 'Low' || m.tex > 256) ok = false;
  if (errors.length) { console.log('errors:', errors.slice(0, 4).join(' / ')); ok = false; }
} catch (e) { console.log('ran:', String(e).slice(0, 300)); ok = false; } finally { await browser.close(); }
console.log(ok ? 'PASS' : 'FAIL');
