// What buildings reach (fire fighting, archers), kept free of the game and the screen so it can be tested under plain node (tests/coverage.test.mjs).
// Every radius comes from the Rust core (`effect_radii`, crates/game-core/src/radii.rs): nothing here repeats a number from the rules.

/** Effect codes, as in radii.rs. */
export const FX_FIRE_FULL = 0, FX_FIRE_HALF = 1, FX_SPARK_GUARD = 2, FX_YARD_HELP = 3, FX_SHOOT = 4, FX_SHOOT_MIN = 5, FX_STATION = 6;
export interface Radius { r: number; fx: number; pct: number }
export const STRIDE = 10;   // buildings_flat: kind, tier, x, z, _, pad height, status, cycle %, workers, residents

export function parseRadii(json: string): Radius[] { const a = JSON.parse(json); return Array.isArray(a) ? a.filter((e: Radius) => e && e.r > 0) : []; }

/** How an effect is drawn: colour (blue for water, orange-red for shooting), dashed for a minimum range, and the strength of the faint fill. */
export const FX_STYLE: Record<number, { color: number; dashed: boolean; fill: number }> = {
  [FX_FIRE_FULL]: { color: 0x4aa8ff, dashed: false, fill: 1 },
  [FX_FIRE_HALF]: { color: 0x7cc4ff, dashed: false, fill: 0.5 },
  [FX_SPARK_GUARD]: { color: 0x9fe0ff, dashed: true, fill: 0 },
  [FX_YARD_HELP]: { color: 0x58d6c0, dashed: false, fill: 0.6 },
  [FX_STATION]: { color: 0xe0623a, dashed: false, fill: 0.6 },
  [FX_SHOOT]: { color: 0xff6a3a, dashed: false, fill: 1 },
  [FX_SHOOT_MIN]: { color: 0xff6a3a, dashed: true, fill: 0 },
};
export const styleOf = (fx: number) => FX_STYLE[fx] ?? FX_STYLE[FX_SHOOT];

const n = (r: number) => String(Math.round(r * 10) / 10);
/** The words for a building's radii, one line per kind of help, in the order they matter; each carries an icon name (see ui/icons.ts). */
export function describe(radii: Radius[]): { icon: string; text: string; fx: number[] }[] {
  const by = (fx: number) => radii.find(e => e.fx === fx);
  const out: { icon: string; text: string; fx: number[] }[] = [];
  const full = by(FX_FIRE_FULL), half = by(FX_FIRE_HALF), spark = by(FX_SPARK_GUARD), yard = by(FX_YARD_HELP), shoot = by(FX_SHOOT), min = by(FX_SHOOT_MIN);
  if (full || half) out.push({ icon: 'water', text: `Fire help: ${full ? `${n(full.r)} full` : ''}${full && half ? ' / ' : ''}${half ? `${n(half.r)} half` : ''}`, fx: [FX_FIRE_FULL, FX_FIRE_HALF] });
  if (spark) out.push({ icon: 'fire', text: `Sparks take half as often within ${n(spark.r)}`, fx: [FX_SPARK_GUARD] });
  if (yard) out.push({ icon: 'buildersyard', text: `Carpenters fight fires within ${n(yard.r)}`, fx: [FX_YARD_HELP] });
  const station = by(FX_STATION);
  if (station) out.push({ icon: 'firestation', text: `Fire brigade within ${n(station.r)}: fights fires without a well, sparks take half as often`, fx: [FX_STATION] });
  if (shoot) out.push({ icon: 'archer', text: `Archers shoot ${n(shoot.r)}${min ? `, not closer than ${n(min.r)}` : ''}`, fx: [FX_SHOOT, FX_SHOOT_MIN] });
  return out;
}
/** The short label drawn on the ground beside a group of rings. */
export const labelFor = (radii: Radius[]) => describe(radii)[0]?.text ?? '';

/** Geometry of a ring of radius `r` laid over the ground: enough segments that the outline stays round, enough rings that the disc follows slopes, and the width of the rim as a part of the radius. */
export function ringParams(r: number): { segments: number; stacks: number; rim: number } {
  const segments = Math.max(48, Math.min(128, Math.ceil(r * 2.6 / 8) * 8));
  return { segments, stacks: Math.max(4, Math.min(12, Math.ceil(r / 4))), rim: Math.max(0.012, Math.min(0.045, 0.8 / r)) };
}

export interface Src { x: number; z: number }
/** 2 inside `full` of a source, 1 inside `half`, else 0. */
export function coverState(x: number, z: number, wells: Src[], full: number, half: number): 0 | 1 | 2 {
  let s: 0 | 1 | 2 = 0;
  for (const w of wells) { const d = Math.hypot(w.x - x, w.z - z); if (d <= full) return 2; if (d <= half) s = 1; }
  return s;
}
/** Indices of buildings (from a buildings_flat array) that can burn and have no well within `half`. `burns` says whether a kind and tier can catch fire. */
export function uncoveredByWells(flat: ArrayLike<number>, wellKind: number, full: number, half: number, burns: (kind: number, tier: number) => boolean): number[] {
  const wells: Src[] = [];
  for (let o = 0; o < flat.length; o += STRIDE) if (flat[o] === wellKind) wells.push({ x: flat[o + 2], z: flat[o + 3] });
  const out: number[] = [];
  for (let o = 0; o < flat.length; o += STRIDE) { const k = flat[o]; if (k === wellKind || !burns(k, flat[o + 1])) continue; if (coverState(flat[o + 2], flat[o + 3], wells, full, half) === 0) out.push(o / STRIDE); }
  return out;
}
/** Indices of wall pieces (the given kinds) that no manned tower reaches. `towers` are those with archers inside, with the range they shoot. */
export function wallsOutOfReach(flat: ArrayLike<number>, wallKinds: ReadonlySet<number>, towers: { x: number; z: number; r: number }[]): number[] {
  const out: number[] = [];
  for (let o = 0; o < flat.length; o += STRIDE) {
    if (!wallKinds.has(flat[o])) continue;
    const x = flat[o + 2], z = flat[o + 3];
    if (!towers.some(t => Math.hypot(t.x - x, t.z - z) <= t.r)) out.push(o / STRIDE);
  }
  return out;
}
