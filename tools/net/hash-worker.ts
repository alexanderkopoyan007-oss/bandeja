// The browser side of hash-core.ts: every case in a worker (a hidden page's timers are throttled), each result posted home.
import { CASES, runCase } from './hash-core.ts';

const who = new URLSearchParams(self.location.search).get('b') ?? 'browser';
(async () => {
  for (let i = 0; i < CASES.length; i++) {
    const t0 = performance.now();
    const r = runCase(CASES[i]!);
    await fetch(`/result?b=${who}&i=${i}&ms=${Math.round(performance.now() - t0)}`, { method: 'POST', body: JSON.stringify(r) });
  }
  await fetch(`/done?b=${who}&ua=${encodeURIComponent(navigator.userAgent)}`, { method: 'POST' });
})().catch((e: unknown) => fetch(`/fail?b=${who}`, { method: 'POST', body: String((e as Error)?.stack ?? e) }));
