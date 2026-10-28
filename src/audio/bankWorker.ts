// Renders the sound bank off the main thread (Phase 6): about half a second of synthesis, mostly the crowd, that
// would otherwise stall the first frames. Posts each family as it finishes (the racket first), then the arena's
// reverb, then `done`. The buffers are transferred, not copied.
import { families, renderFamily, renderRoom, type BankEnv, type Sample } from './bank.ts';

type Msg = { name: string; samples: Sample[][] } | { room: Sample } | { done: true };

function transfers(list: Sample[]): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  for (const s of list) for (const c of s.ch) out.push(c.buffer as ArrayBuffer);
  return out;
}

self.onmessage = (ev: MessageEvent<BankEnv>): void => {
  const env = ev.data;
  const post = (m: Msg, t: ArrayBuffer[]): void => (self as unknown as Worker).postMessage(m, t);
  for (const def of families(env)) {
    const samples = renderFamily(def, env);
    post({ name: def.name, samples }, transfers(samples.flat()));
  }
  const room = renderRoom(env.arena);
  post({ room }, transfers([room]));
  post({ done: true }, []);
};
