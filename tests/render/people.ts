// The mannequin's asset with the people (public/assets/people/) parsed onto it, as the game loads them (no textures).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseBodyAsset, parsePlayerAsset, PEOPLE, type PlayerAsset } from '../../src/render/avatar/asset.ts';

const gz = (path: string): ArrayBuffer => {
  const raw = gunzipSync(readFileSync(new URL('../../public/assets/' + path, import.meta.url)));
  return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
};

/** The people generated with Meshy (data/people.json `guests`): not in PEOPLE, whose tests expect parts, hair cards and a face. */
export const GUESTS = ['meshy', 'meshy2', 'meshy3'];

export function guestAsset(name: string, base: PlayerAsset): PlayerAsset {
  return parseBodyAsset(gz(`people/${name}.bnz`), base);
}

export function mannequinWithPeople(): PlayerAsset {
  const base = parsePlayerAsset(gz('player.bnz'));
  for (const n of PEOPLE) base.people.push(parseBodyAsset(gz(`people/${n}.bnz`), base));
  return base;
}
