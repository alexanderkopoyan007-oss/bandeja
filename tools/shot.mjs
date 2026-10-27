// Screenshot a page in real Chrome. Usage: node tools/shot.mjs <url> <out.png> [waitMs] [width] [height]
import puppeteer from 'puppeteer-core';

const [url = 'http://localhost:5190/', out = 'tools/out/shot.png', wait = '2500', w = '1600', h = '900'] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 1 });
page.on('console', (m) => console.log('[console]', m.type(), m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, +wait));
console.log('hud:', await page.$eval('#hud', (e) => e.textContent).catch(() => '(none)'));
await page.screenshot({ path: out });
await browser.close();
console.log('wrote', out);
