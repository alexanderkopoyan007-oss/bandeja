// Runs AI-vs-AI matches under --trace-gc and counts garbage collections during the measured stretch.
// The sim must allocate nothing per tick, so after JIT warm-up the count should be zero.
// Mode 'avatars' also animates the four player bodies (src/render/avatar: the people, as the game dresses the
// players) once every two ticks (60 fps).
// Usage: node tools/alloc-check.mjs [ticks] [singles|doubles|avatars]   (all three when left out)
// ALLOC_PROFILE=1 lists the top allocation sites of the measured stretch, garbage included.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.argv[2] === '--child') {
  const { MatchSim, PH_OVER } = await import('../src/sim/match.ts');
  const ticks = Number(process.argv[3] ?? 100000);
  const avatars = process.argv[4] === 'avatars';
  const doubles = process.argv[4] === 'doubles' || avatars;
  let draw = () => {};
  if (avatars) {
    const { readFileSync } = await import('node:fs');
    const { gunzipSync } = await import('node:zlib');
    const THREE = await import('three/webgpu');
    const { parsePlayerAsset, parseBodyAsset, PEOPLE } = await import('../src/render/avatar/asset.ts');
    const { Avatar } = await import('../src/render/avatar/avatar.ts');
    const { kitFor } = await import('../src/render/avatar/kit.ts');
    const gz = (f) => { const raw = gunzipSync(readFileSync(new URL('../public/assets/' + f, import.meta.url))); return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength); };
    const asset = parsePlayerAsset(gz('player.bnz'));
    // Dressed as the game dresses them: one of the people each (ALLOC_PEOPLE=0: the mannequin).
    const people = process.env.ALLOC_PEOPLE === '0' ? [] : PEOPLE.map((n) => parseBodyAsset(gz(`people/${n}.bnz`), asset));
    const av = [0, 1, 2, 3].map((i) => new Avatar(people[i] ?? asset, kitFor(i)));
    const scene = new THREE.Scene();
    for (const v of av) scene.add(v.root);
    let k = 0;
    draw = () => {
      if (++k & 1) return;
      for (let i = 0; i < 4; i++) av[i].update(m, m.players[i], i, 1, m.time);
    };
  }
  const make = (seed) => doubles
    ? new MatchSim({ seed, doubles, human: [false, false, false, false] })
    : new MatchSim({ seed, human: [false, false] });
  let m = make(Number(process.env.ALLOC_SEED ?? 1));
  const inputs = doubles ? [null, null, null, null] : [null, null];
  // Warm-up: let V8 optimise every path (serves, rallies, faults, games, sets).
  for (let i = 0; i < 60000; i++) {
    m.step(inputs);
    draw();
    if (m.phase === PH_OVER) m = make(i);
  }
  const { Session } = await import('node:inspector/promises');
  const ses = process.env.ALLOC_PROFILE ? new Session() : null;
  if (ses) {
    ses.connect();
    await ses.post('HeapProfiler.startSampling', { samplingInterval: 256, includeObjectsCollectedByMinorGC: true, includeObjectsCollectedByMajorGC: true });
  }
  console.log('@@START');
  const t0 = performance.now();
  let n = 0;
  for (let i = 0; i < ticks; i++) {
    m.step(inputs);
    draw();
    n++;
    if (m.phase === PH_OVER) break;
  }
  const ms = performance.now() - t0;
  console.log('@@END');
  if (ses) {
    const { profile } = await ses.post('HeapProfiler.stopSampling');
    const agg = new Map();
    const walk = (node, up) => {
      const f = node.callFrame;
      const name = `${f.functionName || '(anon)'} ${f.url.split('/').slice(-2).join('/')}:${f.lineNumber + 1}`;
      if (node.selfSize) agg.set(`${name} <= ${up}`, (agg.get(`${name} <= ${up}`) ?? 0) + node.selfSize);
      for (const c of node.children) walk(c, name);
    };
    walk(profile.head, '');
    for (const [k, v] of [...agg].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`profile ${(v / 1024).toFixed(0).padStart(7)} KB  ${k}`);
  }
  console.log(`ticks ${n}  ${(ms / n * 1000).toFixed(2)} us/tick  points so far ${m.score.games.join('-')} games`);
} else {
  const ticks = process.argv[2] ?? '100000';
  const self = fileURLToPath(import.meta.url);
  let failed = false;
  for (const mode of process.argv[3] ? [process.argv[3]] : ['singles', 'doubles', 'avatars']) {
    const r = spawnSync(process.execPath, ['--trace-gc', self, '--child', ticks, mode], { encoding: 'utf8', maxBuffer: 64 << 20 });
    const out = r.stdout + r.stderr;
    const a = out.indexOf('@@START');
    const b = out.indexOf('@@END');
    if (a < 0 || b < 0) {
      console.log(out.slice(-3000));
      process.exit(1);
    }
    const inside = out.slice(a, b).split('\n').filter((l) => /Scavenge|Mark-Compact|Minor|Mark-sweep/i.test(l));
    const tail = out.slice(b).split('\n').filter((l) => l.startsWith('ticks') || l.startsWith('profile'));
    console.log(`${mode}: ${tail.join('\n')}`);
    // Budget: the sim may cause at most one minor GC per 10k ticks (~83 s of play), each well under a millisecond.
    // Doubles passed into non-inlined functions are boxed by V8, so a few bytes per tick remain; see CLAUDE.md.
    const budget = Math.ceil(Number(ticks) / 10000);
    const worst = Math.max(0, ...inside.map((l) => Number((l.match(/MB, pooled: [\d.]+ MB, ([\d.]+)/) ?? [])[1] ?? 0)));
    console.log(`${mode}: GCs during measured run: ${inside.length} (budget ${budget}), longest ${worst.toFixed(2)} ms`);
    for (const l of inside.slice(0, 3)) console.log('  ' + l.trim());
    if (inside.length > budget || worst >= 1) failed = true;
  }
  process.exit(failed ? 2 : 0);
}
