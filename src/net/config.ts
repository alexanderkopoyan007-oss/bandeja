// Where the rooms are. VITE_ROOMS points a build at another server (tools/net/online-e2e.mjs: a local one).
export const ROOMS_URL: string = import.meta.env.VITE_ROOMS ?? 'wss://bandeja-rooms.alexander-kopoyan007-721.workers.dev';
/** Players on different builds can't play: their sims differ. The build's own name for itself. */
export const BUILD: string = import.meta.env.VITE_BUILD ?? 'dev';
export const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }];

const q = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
/** Tools (tools/net/online-e2e.mjs): a fake link on top of the real one (&lag= one way in ms, &loss= 0..1), and no direct path (&relay=1). */
export const TEST_LAG = Number(q.get('lag') ?? 0);
export const TEST_LOSS = Number(q.get('loss') ?? 0);
export const TEST_RELAY = q.has('relay');
/** Tools: a match of one game (&short=1), to get to the end of it. */
export const TEST_SHORT = q.has('short');
