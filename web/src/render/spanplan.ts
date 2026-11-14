/** The shape of a bridge as a list of boxes, worked out in the bridge's own frame (s along it, t across it, y up). No drawing code in here, so it can be tested. */
export interface Prim { s: number; t: number; y: number; ls: number; lt: number; lh: number; pitch: number; color: number }
export interface SpanIn { length: number; tier: number; hA: number; hB: number; bed: (s: number) => number; options: number }

export const WIDTH = [2.4, 2.8, 3.4, 4.2];             // deck width by tier: footbridge, timber, stone, great
export const PIER_GAP = [5.5, 6.5, 8.5, 11];           // distance between supports by tier
const PALETTE = [{ deck: [0x8a6a46, 0x7a5a3a], post: 0x4a3420, rail: 0x6a4a2e }, { deck: [0x9a7a52, 0x8a6a46], post: 0x56402a, rail: 0x7a5a3a }, { deck: [0xa8a49a, 0x9a968c], post: 0x8c887e, rail: 0xb4afa4 }, { deck: [0xb8b2a6, 0xaaa498], post: 0x9a958a, rail: 0xc4beb2 }];
export const BANK = 1.6;                                // how far the deck reaches onto each bank (the core's margin)

/** Where the supports stand along a bridge of this length: none under a short span, otherwise evenly spaced between the two bank ends. */
export function supportPositions(length: number, tier: number): number[] {
  const water = length - 2 * BANK; if (water <= 7) return [];
  const n = Math.ceil(water / PIER_GAP[tier]) - 1, out: number[] = [];
  for (let k = 0; k < n; k++) out.push(-length / 2 + BANK + ((k + 1) * water) / (n + 1));
  return out;
}

/** Height of the deck's top surface at s: along the straight line between the bank heights, a hand above the ground, with a gentle hump on stone. */
export function deckHeight(i: SpanIn, s: number): number {
  const f = (s + i.length / 2) / i.length, hump = i.tier >= 2 ? Math.sin(Math.PI * f) * (i.tier === 3 ? 0.7 : 0.45) : 0;
  return i.hA + (i.hB - i.hA) * f + 0.55 + hump;
}

export function planSpan(i: SpanIn): Prim[] {
  const t = Math.min(3, Math.max(0, i.tier)), W = WIDTH[t], pal = PALETTE[t], out: Prim[] = [], L = i.length;
  const box = (s: number, tt: number, y: number, ls: number, lt: number, lh: number, color: number, pitch = 0) => out.push({ s, t: tt, y, ls, lt, lh, pitch, color });
  const stone = t >= 2, step = stone ? 1.0 : 0.5;
  // the deck: planks across a wooden bridge, slabs on a stone one (with a thick underside)
  for (let s = -L / 2 + step / 2, k = 0; s < L / 2; s += step, k++) {
    const top = deckHeight(i, s);
    box(s, 0, top - (stone ? 0.2 : 0.07), step * 0.96, W, stone ? 0.4 : 0.14, pal.deck[k % 2]);
    if (stone) box(s, 0, top - 0.7, step, W - 0.5, 0.6, pal.post);
  }
  // the sides: posts and a rail on wood, a continuous parapet on stone
  for (const side of [-1, 1]) {
    const tt = side * (W / 2 - 0.1);
    if (stone) { for (let s = -L / 2 + 0.5; s < L / 2; s += 1.0) box(s, side * (W / 2 + 0.1), deckHeight(i, s) + 0.4, 1.0, 0.36, 0.8, pal.rail); }
    else {
      for (let s = -L / 2 + 0.2; s <= L / 2 + 0.01; s += 2.4) box(s, tt, deckHeight(i, s) + 0.55, 0.2, 0.2, 1.1, pal.post);
      for (let s = -L / 2 + 1.4; s < L / 2; s += 2.4) box(s, tt, deckHeight(i, s) + 0.95, 2.4, 0.12, 0.12, pal.rail);
    }
  }
  // the supports: where the water is too wide for the deck alone, pairs of posts (wood), trestles (timber) or piers with cutwaters (stone)
  for (const s of supportPositions(L, t)) {
    const top = deckHeight(i, s), bed = i.bed(s) - 0.3, h = top - bed;
    if (t === 0) { for (const side of [-1, 1]) box(s, side * (W / 2 - 0.3), bed + h / 2, 0.32, 0.32, h, pal.post); box(s, 0, top - 0.45, 0.3, W, 0.22, pal.rail); }
    else if (t === 1) { for (const side of [-1, 1]) { box(s, side * (W / 2 - 0.2), bed + h / 2, 0.4, 0.4, h, pal.post); box(s + side * 0.5, side * (W / 2 - 0.2), bed + h / 2, 0.14, 0.14, h * 1.04, pal.rail, side * 0.1); } box(s, 0, top - 0.5, 0.5, W, 0.3, pal.rail); box(s, 0, bed + h * 0.4, 0.3, W - 0.4, 0.2, pal.rail); }
    else { box(s, 0, bed + h / 2, t === 3 ? 2.2 : 1.6, W - 0.6, h, pal.post); box(s - (t === 3 ? 1.4 : 1.1), 0, bed + h / 2, 0.8, W - 1.2, h, pal.post, 0); box(s + (t === 3 ? 1.4 : 1.1), 0, bed + h / 2, 0.8, W - 1.2, h, pal.post, 0); }
  }
  // the ends are footed on the banks
  for (const e of [-1, 1]) { const s = e * (L / 2 - 0.5), g = e < 0 ? i.hA : i.hB; box(s, 0, (g + deckHeight(i, s) - 0.1) / 2 - 0.3, 1.0, W + 0.2, Math.max(0.3, deckHeight(i, s) - g + 0.6), stone ? pal.post : pal.rail); }
  // optional designs: lanterns on posts at both ends, pennants
  const ends = [-1, 1];
  if (i.options & 1) for (const e of ends) for (const side of [-1, 1]) { const s = e * (L / 2 - 0.3), top = deckHeight(i, s); box(s, side * (W / 2), top + 1.0, 0.14, 0.14, 2.0, pal.post); box(s, side * (W / 2), top + 2.1, 0.3, 0.3, 0.3, 0xffc860); }
  if (i.options & 2) for (const e of ends) { const s = e * (L / 2 - 0.3), top = deckHeight(i, s); box(s, 0, top + 1.2, 0.1, 0.1, 2.4, pal.post); box(s + e * 0.4, 0, top + 2.1, 0.8, 0.05, 0.5, 0xb03030); }
  return out;
}
