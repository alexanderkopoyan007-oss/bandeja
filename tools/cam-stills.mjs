// Stills of the match cameras (M7 phase A): an AI match in each arena through each camera, mid-rally, into one
// contact sheet. `CAMS=side,dynamic ARENAS=stadium,hall,club-day bash tools/one-chrome.sh node tools/cam-stills.mjs
// <out.png> [base url]` (the dev server: npx vite --port 5190). `WAIT=walk`: the title's establishing shots instead.
import puppeteer from 'puppeteer-core';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = process.argv[2] ?? 'tools/out/cams.png';
const base = process.argv[3] ?? 'http://localhost:5190/';
const cams = (process.env.CAMS ?? 'side,dynamic').split(',');
const arenas = (process.env.ARENAS ?? 'stadium,hall,club-day').split(',');
const W = 960, H = 540;
const dir = mkdtempSync(join(tmpdir(), 'cams-'));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const files = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  // WAIT=walk: the title's establishing shots (M7 phase F), the first three breaks between points in each arena, each
  // 1.5 s into the walk back.
  if (process.env.WAIT === 'walk') {
    cams.splice(0, cams.length, 'break 1', 'break 2', 'break 3');
    for (const arena of arenas) {
      await page.goto(`${base}?autoplay=1&seed=7&arena=${arena}&establish=1&creator=1`, { waitUntil: 'load' });
      for (let n = 1; n <= 3; n++) {
        await page.waitForFunction((n) => {
          const g = window.__bandeja;
          if (!g?.running) return false;
          if (g.sim.walking > 0) {
            if (window.__w0 === undefined) { window.__w0 = g.sim.time; window.__breaks = (window.__breaks ?? 0) + 1; }
            return window.__breaks === n && g.sim.time - window.__w0 > 1.5;
          }
          window.__w0 = undefined;
          return false;
        }, { timeout: 240000, polling: 50 }, n);
        const f = join(dir, `${arena}-walk${n}.png`);
        await page.screenshot({ path: f });
        files.push({ f, label: `${arena} / break ${n}` });
        console.log('shot', arena, 'break', n);
      }
    }
  } else for (const arena of arenas) for (const cam of cams) {
    await page.goto(`${base}?autoplay=1&seed=7&arena=${arena}&camera=${cam}&creator=1`, { waitUntil: 'load' });
    // Mid-rally, a few points in (the ball well away from the server).
    await page.waitForFunction(() => { const g = window.__bandeja; return g && g.running && g.sim.time > 12 && g.sim.phase === 2 && g.sim.rally?.shots >= 2; }, { timeout: 240000, polling: 100 });
    const f = join(dir, `${arena}-${cam}.png`);
    await page.screenshot({ path: f });
    files.push({ f, label: `${arena} / ${cam}` });
    console.log('shot', arena, cam);
  }
} finally {
  await browser.close();
}
// One sheet, a column per camera.
const py = `
import sys, json
from PIL import Image, ImageDraw
items = json.loads(sys.argv[1]); cols = ${cams.length}; W, H = ${W}, ${H}
rows = (len(items) + cols - 1) // cols
sheet = Image.new('RGB', (W * cols, H * rows), 'black')
d = ImageDraw.Draw(sheet)
for i, it in enumerate(items):
    im = Image.open(it['f']).convert('RGB'); x, y = (i % cols) * W, (i // cols) * H
    sheet.paste(im, (x, y)); d.rectangle([x, y, x + 260, y + 26], fill='black'); d.text((x + 8, y + 7), it['label'], fill='white')
sheet.save(sys.argv[2])
`;
writeFileSync(join(dir, 'sheet.py'), py);
execFileSync('python3', [join(dir, 'sheet.py'), JSON.stringify(files), out]);
console.log('wrote', out);
