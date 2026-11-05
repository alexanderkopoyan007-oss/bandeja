// Players' names for a match (review round 3, critic High #7: four AIs named only by their playing style read as an
// exhibition, "YOU · Martillo"). A men's match deals from the owner's own roster (OWNER_ROSTER, 5 Nov 2026), real
// people included at the owner's insistence (told the public game and repo then carry those names). A women's match
// deals made-up players: a first name, a surname and a nation from the match's seed, from common names of that
// nation, never the surname of a well-known professional padel player (PRO_SURNAMES). The playing style stays as the
// player's nickname, shown beside the name.

import { seeded } from './cast.ts';

export interface PlayerName {
  first: string;
  last: string;
  /** IOC-style three-letter code. */
  nation: string;
}

const POOLS: Record<string, { first: string[]; women: string[]; last: string[] }> = {
  ESP: { first: ['Álvaro', 'Diego', 'Javier', 'Pablo', 'Sergio', 'Marcos', 'Rubén', 'Iván', 'Hugo', 'Adrián', 'Raúl', 'Óscar'],
    women: ['Lucía', 'Marta', 'Carmen', 'Elena', 'Paula', 'Sara', 'Noelia', 'Irene'],
    last: ['Ferrer', 'Ortiz', 'Vidal', 'Campos', 'Herrero', 'Prieto', 'Cano', 'Molina', 'Serrano', 'Delgado', 'Castro', 'Pastor', 'Vega', 'Soler'] },
  ARG: { first: ['Tomás', 'Facundo', 'Nicolás', 'Matías', 'Joaquín', 'Lautaro', 'Santiago', 'Gonzalo', 'Ezequiel', 'Bautista'],
    women: ['Camila', 'Florencia', 'Julieta', 'Agustina', 'Rocío', 'Milagros'],
    last: ['Acosta', 'Benítez', 'Medina', 'Sosa', 'Ledesma', 'Quiroga', 'Ferreyra', 'Aguirre', 'Villalba', 'Correa', 'Funes'] },
  ITA: { first: ['Luca', 'Matteo', 'Marco', 'Davide', 'Andrea', 'Paolo', 'Riccardo', 'Filippo'],
    women: ['Giulia', 'Chiara', 'Francesca', 'Elisa', 'Marta'],
    last: ['Bianchi', 'Colombo', 'Ricci', 'Marino', 'Greco', 'Conti', 'Gallo', 'Fontana', 'Barbieri', 'Lombardi'] },
  FRA: { first: ['Julien', 'Thomas', 'Antoine', 'Maxime', 'Louis', 'Nicolas', 'Clément'],
    women: ['Camille', 'Léa', 'Manon', 'Chloé', 'Pauline'],
    last: ['Lefèvre', 'Girard', 'Fournier', 'Lambert', 'Rousseau', 'Mercier', 'Garnier', 'Chevalier'] },
  POR: { first: ['João', 'Tiago', 'Rui', 'Miguel', 'Duarte', 'Gonçalo', 'Nuno'],
    women: ['Inês', 'Beatriz', 'Mariana', 'Catarina'],
    last: ['Carvalho', 'Pereira', 'Teixeira', 'Monteiro', 'Moreira', 'Correia', 'Fonseca'] },
  BRA: { first: ['Rafael', 'Caio', 'Felipe', 'Thiago', 'Bruno', 'Gustavo', 'Vinícius'],
    women: ['Larissa', 'Fernanda', 'Aline', 'Bruna', 'Juliana'],
    last: ['Barbosa', 'Ribeiro', 'Cardoso', 'Rocha', 'Moura', 'Azevedo', 'Pinheiro'] },
  SWE: { first: ['Erik', 'Oskar', 'Viktor', 'Axel', 'Emil', 'Linus'],
    women: ['Elin', 'Sofia', 'Linnea', 'Ebba'],
    last: ['Lindqvist', 'Holm', 'Berg', 'Sjöberg', 'Nyström', 'Ekström'] },
  MEX: { first: ['Emiliano', 'Rodrigo', 'Andrés', 'Ricardo', 'Mateo'],
    women: ['Valeria', 'Ximena', 'Regina', 'Daniela'],
    last: ['Garza', 'Villarreal', 'Treviño', 'Cervantes', 'Zamora', 'Montes'] },
  NED: { first: ['Daan', 'Sem', 'Thijs', 'Bram', 'Jesse'],
    women: ['Sanne', 'Lotte', 'Femke', 'Anouk'],
    last: ['de Vries', 'Bakker', 'Visser', 'Smit', 'Mulder', 'de Boer'] },
  JPN: { first: ['Kenji', 'Haruto', 'Ren', 'Sota', 'Daiki'],
    women: ['Yuki', 'Hana', 'Aoi', 'Misaki', 'Rin'],
    last: ['Nakamura', 'Fujita', 'Ishikawa', 'Morita', 'Okada', 'Matsuda'] },
  KOR: { first: ['Min-jun', 'Ji-ho', 'Seung-hyun', 'Tae-yang'],
    women: ['Min-ji', 'Seo-yeon', 'Ji-woo', 'Ha-eun'],
    last: ['Kang', 'Yoon', 'Shin', 'Hwang', 'Seo'] },
};
/** How often each nation is dealt (padel's countries: Spain and Argentina most). */
const WEIGHTS: Array<[string, number]> = [
  ['ESP', 30], ['ARG', 22], ['ITA', 10], ['FRA', 8], ['POR', 7], ['BRA', 6], ['SWE', 5], ['MEX', 5], ['NED', 4], ['JPN', 3],
];
/**
 * Surnames of well-known professional players (men's and women's tours, 2015-2026), never dealt. The pools above were
 * chosen without them; this list keeps it so if a pool grows (tests/app/names.test.ts).
 */
export const PRO_SURNAMES = [
  'Lebrón', 'Galán', 'Coello', 'Tapia', 'Navarro', 'Belasteguín', 'Stupaczuk', 'Chingotto', 'Di Nenno', 'Gutiérrez', 'Lima',
  'Lamperti', 'Garrido', 'Yanguas', 'Augsburger', 'Ruiz', 'Tello', 'Bergamini', 'Leal', 'Sanz', 'Nieto', 'Moyano',
  'González', 'Gonzalez', 'Rico', 'Cardona', 'Arroyo', 'Silingo', 'Díaz', 'Sánchez', 'Triay', 'Salazar', 'Josemaría',
  'Brea', 'Ortega', 'Icardo', 'Ustero', 'Castelló', 'Fernández', 'Alonso', 'Osoro', 'Martínez', 'Campagnolo', 'Perino',
  'Gil', 'Jardim', 'Libaak', 'Capra', 'Nerone', 'Arce', 'De Pascual', 'Rubio', 'Riera', 'Sainz', 'Llaguno', 'Iglesias',
  'Marrero', 'Calvo', 'Jensen', 'Saiz', 'Caldera', 'Rufo', 'Guinart', 'Goenaga', 'Collombon', 'Godallier', 'Tison',
  'Leygue', 'Scatena', 'Blanqué', 'Moreau', 'Capitani', 'Cremona', 'Cattaneo', 'Sussarello', 'Orsi', 'Stellato',
  'Pappacena', 'Deus', 'Pascoal', 'Nogueira', 'Araújo', 'Windahl', 'Mieres', 'Juárez', 'Bela', 'Quílez', 'Mota',
  'Hernández', 'Pérez', 'Gómez', 'Ramírez', 'Torres', 'Romero', 'Domínguez', 'Ramos', 'Muñoz', 'Álvarez', 'Llobet',
];

/** The owner's roster for men's matches, in their words (5 Nov 2026); a name with no first name is shown as it is. */
export const OWNER_ROSTER: readonly PlayerName[] = [
  { first: '', last: 'Boris', nation: '' },
  { first: 'Nick', last: 'Kyrgios', nation: 'AUS' },
  { first: 'Ben', last: 'Shelton', nation: 'USA' },
  { first: 'Max', last: 'Fleisher', nation: 'USA' },
  { first: 'Bibi', last: 'Netanyahu', nation: 'ISR' },
  { first: 'Saddam', last: 'Hussein', nation: 'IRQ' },
  { first: 'Patrick', last: 'Mouratoglou', nation: 'FRA' },
];

/**
 * Names for a match's `n` players from `seed` (each a different surname); the same seed deals the same names. `cast`:
 * each player's name comes from the nations their face fits (a Japanese name on a European face was the critic's point
 * in review round 4), a women's first name in a women's match.
 */
export function dealNames(seed: number, n: number, cast?: { nations: string[][]; women: boolean }): PlayerName[] {
  const rnd = seeded(seed, 0x5bd1e995);
  const out: PlayerName[] = [];
  const used = new Set<string>();
  // A men's match: the owner's roster, shuffled by the seed (made-up names only past its end).
  const roster = cast?.women ? [] : OWNER_ROSTER.map((p) => ({ p, k: rnd() })).sort((x, y) => x.k - y.k).map((x) => ({ ...x.p }));
  for (let i = 0; i < n; i++) {
    if (i < roster.length) {
      out.push(roster[i]!);
      used.add(roster[i]!.last);
      continue;
    }
    const nations = WEIGHTS.filter((w) => !cast || cast.nations[i]!.includes(w[0]));
    let r = rnd() * nations.reduce((s, w) => s + w[1], 0);
    let nation = nations[0]![0];
    for (const [k, w] of nations) { if (r < w) { nation = k; break; } r -= w; }
    const pool = POOLS[nation]!;
    const firsts = cast?.women ? pool.women : pool.first;
    let first = '', last = '';
    for (let tries = 0; tries < 20; tries++) {
      first = firsts[Math.floor(rnd() * firsts.length)]!;
      last = pool.last[Math.floor(rnd() * pool.last.length)]!;
      if (!used.has(last) && !PRO_SURNAMES.includes(last)) break;
    }
    used.add(last);
    out.push({ first, last, nation });
  }
  return out;
}

/** "D. Campos" (the score rows) or "Diego Campos". */
export function nameOf(p: PlayerName, short: boolean): string {
  if (!p.first) return p.last;
  return short ? `${p.first[0]}. ${p.last}` : `${p.first} ${p.last}`;
}
