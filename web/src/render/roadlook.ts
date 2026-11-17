// What the roads look like: dirt while the castle is small, stone once it has grown. Pure functions on plain arrays (no three.js), so they can be tested under node
// (tests/roadlook.test.mjs); paths.ts turns the pixels into textures. The look is derived from the town hall's tier and is never part of the shared state.

export type RoadMaterial = 'dirt' | 'stone';

/** The castle tier (the town hall's) from which roads are paved in stone: tiers 0 and 1 are dirt tracks, 2 and 3 cobbled. */
export const STONE_FROM_TIER = 2;

/** The material of every road in the village at this castle tier (a road is never part dirt and part stone: the whole village switches at once). */
export function roadMaterialFor(hallTier: number): RoadMaterial {
  const t = Number.isFinite(hallTier) ? Math.max(0, Math.floor(hallTier)) : 0;
  return t >= STONE_FROM_TIER ? 'stone' : 'dirt';
}

/** The half width of the solid part of a road at this tier (it widens at the same tier as it is paved). */
export const roadHalfWidth = (hallTier: number) => (roadMaterialFor(hallTier) === 'stone' ? 1.45 : 1.15);

/** The colour of the grass of the terrain (its two greens, as terrain.ts paints them, times its brightening): what a dirt road has to stand out from. */
export const GRASS_RGB: [number, number, number][] = [[0x5f, 0x8a, 0x3a], [0x7a, 0x9a, 0x45]].map(c => c.map(v => Math.min(255, Math.round(v * 1.18))) as [number, number, number]);

/** The patch of trodden earth under a building is a faint, plain tint (colour as a 0..1 multiplier, and the most opaque it gets), not a road: it never has the road's texture. */
export const APRON_RGB: [number, number, number] = [0.6, 0.5, 0.36];
export const APRON_ALPHA = 0.35;

const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
/** Relative luminance (0..1) of an sRGB colour with channels 0..255. */
export const luminance = (r: number, g: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

/** The mean colour of RGBA pixels. */
export function meanColor(px: ArrayLike<number>): [number, number, number] {
  let r = 0, g = 0, b = 0; const n = px.length / 4;
  for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; b += px[i + 2]; }
  return [r / n, g / n, b / n];
}

function rng(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** Pixels (RGBA, size x size) of packed earth: a dark warm brown, two shallow cart ruts running along the road (v), grit, pebbles and dark clods. Seamless along v. */
export function dirtPixels(size = 128): Uint8ClampedArray {
  const px = new Uint8ClampedArray(size * size * 4), rand = rng(4711);
  const base = [112, 82, 52];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const rut = Math.exp(-Math.pow((u - 0.3) / 0.07, 2)) + Math.exp(-Math.pow((u - 0.7) / 0.07, 2));   // darker, damp wheel tracks
    const crown = 1 + 0.1 * Math.cos((u - 0.5) * Math.PI * 2);   // a little paler along the middle of the way
    const wave = 1 + 0.05 * Math.sin(v * Math.PI * 4 + u * 3);
    const k = (1 - 0.3 * rut) * crown * wave * (0.9 + rand() * 0.2);
    const o = (y * size + x) * 4;
    px[o] = base[0] * k; px[o + 1] = base[1] * k; px[o + 2] = base[2] * k; px[o + 3] = 255;
  }
  const dot = (cx: number, cy: number, r: number, c: number[], a: number) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r + 0.5) continue;
      const x = (Math.round(cx) + dx + size) % size, y = (Math.round(cy) + dy + size) % size, o = (y * size + x) * 4;
      for (let q = 0; q < 3; q++) px[o + q] = px[o + q] * (1 - a) + c[q] * a;
    }
  };
  for (let i = 0; i < 70; i++) dot(rand() * size, rand() * size, 1 + Math.floor(rand() * 2), [150, 132, 104], 0.55);   // pebbles
  for (let i = 0; i < 40; i++) dot(rand() * size, rand() * size, 1, [60, 40, 22], 0.5);                               // dark clods
  return px;
}

/** Pixels (RGBA) of a cobbled paving: rounded grey stones in staggered rows with dark joints, each stone a little different. Seamless. */
export function stonePixels(size = 128): Uint8ClampedArray {
  const px = new Uint8ClampedArray(size * size * 4), rand = rng(1313);
  const rows = 8, cols = 8, rh = size / rows, cw = size / cols;
  const tone = Array.from({ length: rows * cols }, () => 0.82 + rand() * 0.3);
  const warm = Array.from({ length: rows * cols }, () => rand());
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = Math.floor(y / rh), off = (r % 2) * cw * 0.5, xs = (x + off) % size, c = Math.floor(xs / cw);
    const fx = (xs / cw - c) * 2 - 1, fy = (y / rh - r) * 2 - 1;
    const edge = Math.max(Math.pow(Math.abs(fx), 4), Math.pow(Math.abs(fy), 4));   // 0 in the middle of a stone, 1 at its rim
    const t = tone[r * cols + c], w = warm[r * cols + c];
    const k = t * (1 - 0.55 * Math.pow(edge, 1.5)) * (0.94 + rand() * 0.12) * (edge > 0.9 ? 0.55 : 1);
    const o = (y * size + x) * 4;
    px[o] = (176 + 10 * w) * k; px[o + 1] = (170 + 4 * w) * k; px[o + 2] = (160 - 8 * w) * k; px[o + 3] = 255;
  }
  return px;
}

/** The pixels of a material's texture. */
export const roadPixels = (m: RoadMaterial, size = 128) => (m === 'stone' ? stonePixels(size) : dirtPixels(size));
