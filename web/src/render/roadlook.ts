// What the roads look like. A road has four surfaces, the tiers the player resurfaces it through: dirt, gravel, cobbles and flagstones (the core's road tier 0..3). Pure functions on plain arrays
// (no three.js), so they can be tested under node (tests/roadlook.test.mjs); paths.ts turns the pixels into one array texture and blends the layers in the shader.
// The look is never part of the shared state: it follows the tier and design the core hands over with every line of road (World.road_lines_flat).

export type RoadMaterial = 'dirt' | 'gravel' | 'cobble' | 'flagstone';
export const ROAD_MATERIALS: RoadMaterial[] = ['dirt', 'gravel', 'cobble', 'flagstone'];
/** The highest road tier (the core's `max_tier(ROAD)`). */
export const MAX_ROAD_TIER = 3;

/** The names of the surfaces, as the panel shows them. */
export const ROAD_TIER_NAMES = ['Dirt track', 'Gravel road', 'Cobbled road', 'Flagstone road'];

/** The surface of a road tier (anything out of range is the nearest one). */
export function roadMaterialOfTier(tier: number): RoadMaterial {
  const t = Number.isFinite(tier) ? Math.max(0, Math.min(MAX_ROAD_TIER, Math.floor(tier))) : 0;
  return ROAD_MATERIALS[t];
}

/** The half width of the solid part of every road (one width for all surfaces, so that a stretch can change its surface without its edges stepping). */
export const ROAD_HALF = 1.3;
/** Kept for the callers that ask for it by castle tier: the width no longer depends on it. */
export const roadHalfWidth = (_hallTier = 0) => ROAD_HALF;

/** The design options of a road (core bits): trees, hedges and flowers, benches, lanterns. */
export const ROAD_OPT = { trees: 1, hedges: 2, benches: 4, lanterns: 8 } as const;

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

/** Seamless value noise on a size x size grid with `cells` lattice cells per side, 0..1. */
export function tileNoise(size: number, cells: number, seed: number): Float32Array {
  const rand = rng(seed), lat = new Float32Array(cells * cells); for (let i = 0; i < lat.length; i++) lat[i] = rand();
  const out = new Float32Array(size * size), sm = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = (x / size) * cells, fy = (y / size) * cells, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = sm(fx - x0), ty = sm(fy - y0);
    const a = lat[(y0 % cells) * cells + (x0 % cells)], b = lat[(y0 % cells) * cells + ((x0 + 1) % cells)], c = lat[((y0 + 1) % cells) * cells + (x0 % cells)], d = lat[((y0 + 1) % cells) * cells + ((x0 + 1) % cells)];
    out[y * size + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  }
  return out;
}

/** Two octaves of tile noise, 0..1: broad patchiness for weathering and wear. */
function weather(size: number, seed: number) {
  const a = tileNoise(size, 4, seed), b = tileNoise(size, 11, seed + 1), o = new Float32Array(size * size);
  for (let i = 0; i < o.length; i++) o[i] = a[i] * 0.6 + b[i] * 0.4;
  return o;
}

/** Paint a soft disc into the pixels (wrapping at the edges, so the texture stays seamless). */
function dot(px: Uint8ClampedArray, size: number, cx: number, cy: number, r: number, c: number[], a: number) {
  const R = Math.ceil(r);
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const d = Math.hypot(dx, dy); if (d > r) continue;
    const x = (Math.round(cx) + dx + size * 4) % size, y = (Math.round(cy) + dy + size * 4) % size, o = (y * size + x) * 4, k = a * (1 - (d / r) * (d / r) * 0.6);
    for (let q = 0; q < 3; q++) px[o + q] = px[o + q] * (1 - k) + c[q] * k;
  }
}

/** Pixels (RGBA, size x size) of packed earth: a dark warm brown with shallow cart ruts along the road (v), a paler crown, damp patches, grit, pebbles and dark clods. Seamless. */
export function dirtPixels(size = 128): Uint8ClampedArray {
  const px = new Uint8ClampedArray(size * size * 4), rand = rng(4711), wx = weather(size, 91), grain = tileNoise(size, 32, 17);
  const base = [128, 96, 62];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, i = y * size + x;
    const rut = Math.exp(-Math.pow((u - 0.3) / 0.07, 2)) + Math.exp(-Math.pow((u - 0.7) / 0.07, 2));   // darker, damp wheel tracks
    const crown = 1 + 0.1 * Math.cos((u - 0.5) * Math.PI * 2);   // a little paler along the middle of the way
    const wave = 1 + 0.05 * Math.sin(v * Math.PI * 4 + u * 3);
    const damp = 1 - 0.16 * Math.max(0, wx[i] - 0.5) * 2;   // patches that stayed wet
    const k = (1 - 0.22 * rut) * crown * wave * damp * (0.88 + grain[i] * 0.24) * (0.94 + rand() * 0.12);
    const o = i * 4;
    px[o] = base[0] * k; px[o + 1] = base[1] * k; px[o + 2] = base[2] * k; px[o + 3] = 255;
  }
  for (let i = 0; i < 80; i++) dot(px, size, rand() * size, rand() * size, 1 + Math.floor(rand() * 2), [150, 132, 104], 0.55);   // pebbles
  for (let i = 0; i < 45; i++) dot(px, size, rand() * size, rand() * size, 1, [60, 40, 22], 0.5);                                // dark clods
  for (let i = 0; i < 26; i++) { const x = rand() < 0.5 ? rand() * size * 0.14 : size * (0.86 + rand() * 0.14); dot(px, size, x, rand() * size, 1 + rand(), [96, 112, 56], 0.5); }   // grass creeping in at the verges
  return px;
}

/** Pixels (RGBA) of a gravel road: a pale tan bed of small stones, each lit on one side and shaded on the other, with two faint wheel tracks and a tuft-free crown. Seamless. */
export function gravelPixels(size = 128): Uint8ClampedArray {
  const px = new Uint8ClampedArray(size * size * 4), rand = rng(2024), wx = weather(size, 55), fine = tileNoise(size, 48, 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, i = y * size + x, rut = Math.exp(-Math.pow((u - 0.3) / 0.08, 2)) + Math.exp(-Math.pow((u - 0.7) / 0.08, 2));
    const k = (1 - 0.14 * rut) * (0.9 + fine[i] * 0.2) * (0.94 + wx[i] * 0.12) * (0.95 + rand() * 0.1);
    const o = i * 4; px[o] = 168 * k; px[o + 1] = 152 * k; px[o + 2] = 122 * k; px[o + 3] = 255;
  }
  const tones = [[196, 184, 158], [150, 140, 122], [176, 160, 128], [128, 116, 98], [208, 198, 176], [160, 132, 100]];
  for (let n = 0; n < 520; n++) {
    const cx = rand() * size, cy = rand() * size, r = 1 + rand() * 2.1, t = tones[Math.floor(rand() * tones.length)];
    dot(px, size, cx + 0.8, cy + 0.9, r, [58, 48, 36], 0.4);   // the shadow it throws
    dot(px, size, cx, cy, r, t, 0.9);
    dot(px, size, cx - r * 0.3, cy - r * 0.3, r * 0.45, [236, 228, 208], 0.35);   // a glint on its sun side
  }
  return px;
}

/** Pixels (RGBA) of cobbles: rounded stones of different greys and warm tints in staggered rows with dark joints and a little moss in them. Seamless in both directions (and mirrored
 *  across the road at a joint, so it has no edge of its own: the verge is made in the shader). */
export function cobblePixels(size = 128): Uint8ClampedArray {
  const px = new Uint8ClampedArray(size * size * 4), rand = rng(1313), wx = weather(size, 7), moss = tileNoise(size, 14, 29);
  const rows = 8, cols = 8, rh = size / rows, cw = size / cols;
  const tone = Array.from({ length: rows * cols }, () => 0.8 + rand() * 0.32), warm = Array.from({ length: rows * cols }, () => rand()), jx = Array.from({ length: rows * cols }, () => (rand() - 0.5) * 0.16);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = Math.floor(y / rh), off = (r % 2) * cw * 0.5, xs = (x + off) % size, c = Math.floor(xs / cw);
    const fx = (xs / cw - c) * 2 - 1 + jx[r * cols + c], fy = (y / rh - r) * 2 - 1;
    const edge = Math.max(Math.pow(Math.abs(fx), 4), Math.pow(Math.abs(fy), 4));   // 0 in the middle of a stone, 1 at its rim
    const t = tone[r * cols + c], w = warm[r * cols + c], i = y * size + x, u = x / size;
    const dome = 1 - 0.25 * (fx * fx + fy * fy) * 0.5 + 0.1 * (-fx - fy) * 0.5;   // lit from the upper left
    let k = t * dome * (1 - 0.55 * Math.pow(edge, 1.5)) * (0.94 + rand() * 0.12) * (0.92 + wx[i] * 0.16) * (edge > 0.9 ? 0.5 : 1);
    let rr = (176 + 10 * w) * k, gg = (170 + 4 * w) * k, bb = (160 - 8 * w) * k;
    const joint = Math.min(1, Math.max(0, (edge - 0.55) / 0.45)), mossy = joint * Math.max(0, moss[i] - 0.4) * 1.6;
    rr = rr * (1 - mossy * 0.6) + 70 * mossy * 0.6; gg = gg * (1 - mossy * 0.6) + 96 * mossy * 0.6; bb = bb * (1 - mossy * 0.6) + 48 * mossy * 0.6;
    const o = i * 4; px[o] = rr; px[o + 1] = gg; px[o + 2] = bb; px[o + 3] = 255;
  }
  return px;
}

/** Pixels (RGBA) of flagstones: big flat slabs, two across and three along, laid with tight joints in a running bond, pale and warm with veining and weathering.
 *  Seamless in both directions, and no edge of its own (the verge is made in the shader). */
export function flagstonePixels(size = 128): Uint8ClampedArray {
  const px = new Uint8ClampedArray(size * size * 4), rand = rng(9090), wx = weather(size, 123), vein = tileNoise(size, 6, 41), fine = tileNoise(size, 40, 8);
  const rows = 3, rh = size / rows, slabs = 2, sw = size / slabs;
  const slabTone = Array.from({ length: rows * slabs }, () => 0.9 + rand() * 0.2), slabWarm = Array.from({ length: rows * slabs }, () => rand());
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = Math.floor(y / rh), off = (r % 2) * sw * 0.5, xs = (x + off) % size, c = Math.floor(xs / sw), s = r * slabs + c;
    const dx = Math.min(xs - c * sw, (c + 1) * sw - xs), dy = Math.min(y - r * rh, (r + 1) * rh - y), d = Math.min(dx, dy);   // pixels from the joint
    const joint = d < 1.2 ? 0.45 + 0.2 * d : d < 2.6 ? 0.88 + 0.12 * ((d - 1.2) / 1.4) : 1;   // a dark joint, a worn chamfer
    const i = y * size + x, u = x / size;
    const v1 = Math.abs(vein[i] - 0.5) < 0.03 ? 0.93 : 1;   // a pale vein through the stone
    let k = slabTone[s] * joint * v1 * (0.9 + fine[i] * 0.2) * (0.9 + wx[i] * 0.2) * (0.97 + rand() * 0.06);
    const w = slabWarm[s];
    let rr = (204 + 8 * w) * k, gg = (198 + 2 * w) * k, bb = (184 - 8 * w) * k;
    const o = i * 4; px[o] = rr; px[o + 1] = gg; px[o + 2] = bb; px[o + 3] = 255;
  }
  return px;
}

/** Pixels (RGBA) of the stone road a castle of tier 2 and up used to have everywhere: the cobbles. */
export const stonePixels = cobblePixels;

/** The pixels of a material's texture. */
export function roadPixels(m: RoadMaterial, size = 128): Uint8ClampedArray {
  switch (m) { case 'gravel': return gravelPixels(size); case 'cobble': return cobblePixels(size); case 'flagstone': return flagstonePixels(size); default: return dirtPixels(size); }
}
