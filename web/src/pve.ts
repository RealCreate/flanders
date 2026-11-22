// PVE: the choices that set up a game against two computer-run villages (see docs/PVE.md). Pure functions only; main.ts owns the villages.

/** How many computer villages a PVE game has. */
export const AI_COUNT = 2;
/** How many demo layouts the core knows (`Ai.layout_count()`); the number here is only for tests and fallbacks. */
export const LAYOUT_COUNT = 10;

const AI_NAMES = ['Lord Baldric', 'Lady Ysolde', 'Sir Hubert', 'Dame Agnes', 'Lord Wymund', 'Lady Cecily', 'Sir Osmund', 'Dame Mabel', 'Lord Reynald', 'Lady Joan'];

/** A small deterministic stream (xorshift) for the page's own choices; the same seed always gives the same villages. */
export function stream(seed: number) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/** A string to a 32-bit number. */
export function hashString(text: string): number { let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }

/** The stand-in "public key" of the n-th computer village. It passes `isKey` in net/validate.ts, so commands that mention it (a raid `from` it, goods `to` it) can be saved and read back. */
export const aiKey = (n: number) => `pve-computer-${n + 1}-village-key`;
export const isAiKey = (key: string) => /^pve-computer-\d+-village-key$/.test(key);

/** Which demo layouts the computer villages use: each picked at random (from the world name and the player's name), no two the same. */
export function pickLayouts(world: string, player: string, layouts = LAYOUT_COUNT, count = AI_COUNT): number[] {
  const rnd = stream(hashString(`${world}|${player}|pve`));
  const pool = Array.from({ length: layouts }, (_, i) => i), out: number[] = [];
  while (out.length < count && pool.length) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return out;
}

/** Where the computer villages stand: the village sites a good way off (the nearest ones beyond `far`) that are not the player's own, at least `gap` apart from each other. */
export function pickSites(sites: { x: number; z: number }[], mine: number, count = AI_COUNT, gap = 150, far = 500): number[] {
  const me = sites[mine]; if (!me) return [];
  const order = sites.map((s, i) => ({ i, d: Math.hypot(s.x - me.x, s.z - me.z) })).filter(s => s.i !== mine && s.d > 120).sort((a, b) => a.d - b.d || a.i - b.i);
  // far from the player: sites at least `far` away come first (nearest of those first), the closer ones only if there are too few
  order.sort((a, b) => Number(b.d >= far) - Number(a.d >= far));
  const out: number[] = [];
  for (const s of order) { if (out.length >= count) break; if (out.every(o => Math.hypot(sites[o].x - sites[s.i].x, sites[o].z - sites[s.i].z) >= gap)) out.push(s.i); }
  for (const s of order) { if (out.length >= count) break; if (!out.includes(s.i)) out.push(s.i); }   // too few sites far enough apart: take what there is
  return out;
}

/** A name for the n-th computer village. */
export const aiName = (world: string, n: number) => AI_NAMES[(hashString(world) + n * 3) % AI_NAMES.length];

/** The raid request the core hands back from `Ai.step`: [1, six soldier counts]. Returns the soldiers, or null when `req` holds none. Several requests may follow one another. */
export function raidRequests(req: ArrayLike<number>): number[][] {
  const out: number[][] = [];
  for (let i = 0; i + 6 < req.length; i += 7) if (req[i] === 1) out.push(Array.from({ length: 6 }, (_, k) => Math.max(0, req[i + 1 + k] | 0)));
  return out;
}
