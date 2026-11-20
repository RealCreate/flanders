import * as THREE from 'three';
import { tileableNoise } from './water';

export type Surface = 'linen' | 'fleece' | 'fur' | 'feathers' | 'hide';
const fract = (n: number) => n - Math.floor(n);
const wave = (n: number) => Math.cos(n * Math.PI * 2);

/** Neutral detail maps. Vertex and instance colours supply the coat or dye underneath. */
const patterns: Record<Surface, (u: number, v: number, noise: number) => number> = {
  linen(u, v, noise) {
    const x = u * 12, y = v * 12;
    const warp = (0.5 + 0.5 * wave(x)) ** 3;
    const weft = (0.5 + 0.5 * wave(y)) ** 3;
    const over = 0.5 + 0.5 * wave(x / 2) * wave(y / 2);
    return 0.81 + 0.15 * (warp * over + weft * (1 - over)) + 0.06 * noise;
  },
  fleece(u, v, noise) {
    const row = v * 8;
    const x = fract(u * 8 + Math.floor(row) * 0.5) - 0.5;
    const y = fract(row) - 0.5;
    const curl = wave(Math.hypot(x, y) * 3 - Math.atan2(y, x) / (2 * Math.PI));
    const tuft = 1 - Math.min(1, (x * x + y * y) * 3.2);
    return 0.78 + tuft * (0.13 + 0.055 * curl) + 0.10 * noise;
  },
  fur(u, v, noise) {
    const strands = wave(u * 22 + v * 5 + 0.24 * wave(v * 3));
    return 0.82 + 0.08 * strands + 0.15 * noise;
  },
  feathers(u, v, noise) {
    const row = v * 8;
    const x = 2 * Math.abs(fract(u * 8 + Math.floor(row) * 0.5) - 0.5);
    const edge = fract(row - x * x * 0.20);
    return 0.75 + 0.17 * Math.min(1, edge * 4) + 0.09 * (1 - x) + 0.07 * noise;
  },
  hide(u, v, noise) {
    const stubble = Math.max(0, wave(u * 16 + v * 6) * wave(v * 13));
    return 0.85 + 0.15 * noise - 0.09 * stubble ** 4;
  },
};

const textures = new Map<Surface, THREE.DataTexture>();
export function surfaceTexture(surface: Surface) {
  const existing = textures.get(surface);
  if (existing) return existing;

  const size = 128, data = new Uint8Array(size * size * 4);
  const noise = tileableNoise(size, [[6, 0.65, false], [28, 0.35, false]], 6151);
  const pattern = patterns[surface];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const value = Math.round(255 * Math.min(1, pattern((x + 0.5) / size, (y + 0.5) / size, noise[i])));
    data.set([value, value, value, 255], 4 * i);
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = surface;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  textures.set(surface, texture);
  return texture;
}
