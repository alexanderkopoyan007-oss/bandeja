// Downloads the public reference photos listed in reference/photos.json from Wikimedia Commons into
// reference/photos/ (gitignored: the photos stay out of the repo and the build; their sources and licences are in
// reference/SOURCES.md). Usage: node tools/fetch-reference.mjs [width]
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';

const width = Number(process.argv[2] ?? 2000);
const list = JSON.parse(await readFile(new URL('../reference/photos.json', import.meta.url), 'utf8'));
const dir = new URL('../reference/photos/', import.meta.url);
await mkdir(dir, { recursive: true });
const UA = { 'User-Agent': 'bandeja-reference/1.0 (github.com/alexanderkopoyan007-oss/bandeja)' };
const strip = (s) => (s ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const rows = [];
const pause = () => new Promise((r) => setTimeout(r, 1500)); // Commons rate-limits bursts
async function get(url) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, { headers: UA });
    if (r.ok) return r;
    if (i === 4) throw new Error(`${r.status} ${url}`);
    await new Promise((res) => setTimeout(res, 5000 * (i + 1)));
  }
}
for (const p of list.photos) {
  await pause();
  const q = new URLSearchParams({ action: 'query', prop: 'imageinfo', iiprop: 'url|size|extmetadata', iiurlwidth: String(width), format: 'json', titles: `File:${p.file}` });
  const d = await (await get(`https://commons.wikimedia.org/w/api.php?${q}`)).json();
  const ii = Object.values(d.query.pages)[0].imageinfo[0];
  const em = ii.extmetadata;
  rows.push(`| \`${p.id}\` | ${p.what} | ${strip(em.Artist?.value)} | ${strip(em.LicenseShortName?.value)} | ${ii.descriptionurl} |`);
  const out = new URL(`${p.id}.jpg`, dir);
  if (await access(out).then(() => true, () => false)) continue;
  const img = Buffer.from(await (await get(ii.thumburl)).arrayBuffer());
  await writeFile(out, img);
  console.log(p.id, `${ii.thumbwidth}x${ii.thumbheight}`, `${(img.length / 1024) | 0} KB`);
}
console.log(['| id | what | author | licence | source |', '|---|---|---|---|---|', ...rows].join('\n'));
