// The server side of online play, two Durable Objects. Room: one per match code. It introduces the players and carries what
// they send each other until WebRTC connects them, and after that for any pair with no direct path. It keeps nothing: a room
// lasts as long as anyone is in it. Queue: one, for everyone looking for a public match; it groups them by build and distance
// and hands each group a room. Deploy with `npx wrangler@4.156.2 deploy` from this folder (the URL is in src/net/config.ts).
import { DurableObject } from 'cloudflare:workers';

const MAX_PLAYERS = 4;
const MAX_TEXT = 16384;
const MAX_BINARY = 4096;
const LETTERS = 'BCDFGHJKLMNPQRSTVWXZ';
const CODE = /^[BCDFGHJKLMNPQRSTVWXZ]{5}$/;
const ALLOWED = [/^https:\/\/alexanderkopoyan007-oss\.github\.io$/, /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
/** How long a group of two or three waits for more before it starts anyway (s). */
const FILL_S = 8;
const MAX_WAITING = 500;
/** From one address: a house can look for a match together, but one script can't fill the queue. */
const MAX_PER_ADDRESS = 4;
/** How far apart players can be matched (km), by how long the longest of them has waited (s). 2,500 km is about 30 ms one way. */
const reach = (waited) => (waited < 10 ? 2500 : waited < 20 ? 6000 : waited < 35 ? 10000 : Infinity);

/** A browser can't read a refused upgrade's status: the refusal is a message on an accepted socket. */
function refuse(why) {
  const pair = new WebSocketPair();
  pair[1].accept();
  pair[1].send(JSON.stringify({ t: 'no', why }));
  pair[1].close(4000, why);
  return new Response(null, { status: 101, webSocket: pair[0] });
}

/** To a socket that may be closing. */
function say(ws, m) {
  try { ws.send(JSON.stringify(m)); } catch { /* it's going anyway */ }
}

const live = (ctx) => ctx.getWebSockets().flatMap((ws) => {
  const a = ws.deserializeAttachment();
  return a ? [{ ws, ...a }] : [];
});

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // The socket can sit silent through a whole match once WebRTC is up. A beat keeps it open without waking the room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(req) {
    const url = new URL(req.url), create = url.searchParams.get('create') === '1', v = (url.searchParams.get('v') ?? '').slice(0, 64);
    const max = Math.max(2, Math.min(MAX_PLAYERS, Number(url.searchParams.get('max')) || MAX_PLAYERS));
    const all = live(this.ctx);
    if (create && all.length > 0) return refuse('taken');
    if (!create && all.length === 0) return refuse('none');
    if (all.length >= (create ? max : all[0].max)) return refuse('full');
    if (!create && all[0].v !== v) return refuse('version');
    const id = all.reduce((n, s) => Math.max(n, s.id + 1), 0);
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ id, v, host: create, max: create ? max : all[0].max });
    pair[1].send(JSON.stringify({ t: 'in', you: id, host: all.find((s) => s.host)?.id ?? id, peers: all.map((s) => s.id) }));
    for (const s of all) say(s.ws, { t: 'join', id });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  webSocketMessage(ws, msg) {
    const me = ws.deserializeAttachment()?.id;
    if (me === undefined) return;
    if (typeof msg === 'string') {
      if (msg.length > MAX_TEXT) return;
      let m;
      try { m = JSON.parse(msg); } catch { return; }
      const out = JSON.stringify({ t: 'msg', from: me, d: m?.d });
      for (const s of live(this.ctx)) if (s.id !== me && (m?.to === -1 || m?.to === s.id)) { try { s.ws.send(out); } catch { /* going */ } }
    } else if (msg.byteLength >= 1 && msg.byteLength <= MAX_BINARY) {
      // Game packets: the first byte is who it's for, and leaves as who it's from.
      const b = new Uint8Array(msg.slice(0)), to = b[0];
      b[0] = me;
      for (const s of live(this.ctx)) if (s.id === to) { try { s.ws.send(b.buffer); } catch { /* going */ } }
    }
  }

  webSocketClose(ws) { this.gone(ws); }
  webSocketError(ws) { this.gone(ws); }

  /** Whoever leaves, the room goes on: if it was the host, the longest here takes over the lobby. */
  gone(ws) {
    const a = ws.deserializeAttachment();
    if (!a) return;
    ws.serializeAttachment(null);
    try { ws.close(1000, 'bye'); } catch { /* already closed */ }
    const rest = live(this.ctx);
    for (const s of rest) say(s.ws, { t: 'left', id: a.id });
    if (!a.host || rest.length === 0) return;
    const next = rest.reduce((x, y) => (y.id < x.id ? y : x));
    next.ws.serializeAttachment({ id: next.id, v: next.v, host: true, max: next.max });
    for (const s of rest) say(s.ws, { t: 'host', id: next.id });
  }
}

function km(a, b) {
  if (!Number.isFinite(a.lat) || !Number.isFinite(b.lat)) return 0;
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function newCode() {
  const b = crypto.getRandomValues(new Uint8Array(5));
  return Array.from(b, (x) => LETTERS[x % LETTERS.length]).join('');
}

export class Queue extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(req) {
    const url = new URL(req.url), from = req.headers.get('CF-Connecting-IP') ?? '', all = live(this.ctx);
    if (all.length >= MAX_WAITING || all.filter((s) => s.from === from).length >= MAX_PER_ADDRESS) return refuse('busy');
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({
      v: (url.searchParams.get('v') ?? '').slice(0, 64), at: Date.now(), from,
      lat: parseFloat(url.searchParams.get('lat') ?? ''), lon: parseFloat(url.searchParams.get('lon') ?? ''),
    });
    this.form();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  /** The waiting beat every few seconds: it's what moves the queue on, with nothing kept running here. */
  webSocketMessage() { this.form(); }
  webSocketClose(ws) { this.gone(ws); }
  webSocketError(ws) { this.gone(ws); }

  gone(ws) {
    ws.serializeAttachment(null);
    try { ws.close(1000, 'bye'); } catch { /* already closed */ }
    this.form();
  }

  form() {
    const now = Date.now(), waiting = live(this.ctx).sort((x, y) => x.at - y.at), taken = new Set();
    for (const a of waiting) {
      if (taken.has(a.ws)) continue;
      const waited = (now - a.at) / 1000, r = reach(waited);
      const group = [a, ...waiting.filter((b) => b !== a && !taken.has(b.ws) && b.v === a.v && km(a, b) <= r)].slice(0, MAX_PLAYERS);
      if (group.length < 2 || (group.length < MAX_PLAYERS && waited < FILL_S)) continue;
      const code = newCode();
      group.forEach((g, i) => {
        taken.add(g.ws);
        g.ws.serializeAttachment(null);
        say(g.ws, { t: 'match', code, host: i === 0, n: group.length });
        try { g.ws.close(1000, 'matched'); } catch { /* going */ }
      });
    }
    for (const a of waiting) if (!taken.has(a.ws)) say(a.ws, { t: 'wait', n: waiting.filter((b) => !taken.has(b.ws) && b.v === a.v).length });
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), m = url.pathname.match(/^\/room\/([A-Z]{5})$/);
    if (url.pathname === '/') return new Response('BANDEJA rooms');
    if (url.pathname !== '/find' && (!m || !CODE.test(m[1]))) return new Response('not found', { status: 404 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
    const origin = req.headers.get('Origin') ?? '';
    if (!ALLOWED.some((r) => r.test(origin))) return new Response('forbidden', { status: 403 });
    if (!m) {
      // Only the rough place, for a short wait: nothing here is kept.
      url.searchParams.set('lat', String(req.cf?.latitude ?? ''));
      url.searchParams.set('lon', String(req.cf?.longitude ?? ''));
      return env.QUEUE.get(env.QUEUE.idFromName('world')).fetch(new Request(url, req));
    }
    return env.ROOM.get(env.ROOM.idFromName(m[1])).fetch(req);
  },
};
