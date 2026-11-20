import * as THREE from 'three';

/** What the water shader needs to know about the land under it: a texture of the ground height, one texel per terrain vertex. */
export interface DepthSource { heightTex: THREE.Texture; half: number; step: number; nv: number }

/** Smooth tileable value noise: a square of `size` samples, summed from layers of [cells across, amplitude, ridged]. Wraps at the edges, so it tiles without a seam. */
export function tileableNoise(size: number, layers: readonly (readonly [number, number, boolean])[], seed = 1234567): Float32Array {
  const h = new Float32Array(size * size); let s = seed; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (const [cells, amp, ridged] of layers) {
    const lat = new Float32Array(cells * cells); for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells, fy = (y / size) * cells, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty), x1 = (x0 + 1) % cells, y1 = (y0 + 1) % cells;
      const a = lat[y0 % cells * cells + x0 % cells], b = lat[y0 % cells * cells + x1], c = lat[y1 * cells + x0 % cells], d = lat[y1 * cells + x1];
      let v = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
      if (ridged) v = 1 - Math.abs(v * 2 - 1);
      h[y * size + x] += v * amp;
    }
  }
  return h;
}

/** A seamless normal map of rippling water: four layers of smooth noise (the finer ones sharper, for glints), turned into slopes. Tiles without a seam. */
export function waterNormalTexture(size = 512): THREE.DataTexture {
  const h = new Float32Array(size * size);
  let seed = 1234567; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (const [cells, amp, ridged] of [[4, 1.0, false], [8, 0.55, false], [16, 0.3, true], [32, 0.16, true]] as const) {
    const lat = new Float32Array(cells * cells); for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells, fy = (y / size) * cells, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty), x1 = (x0 + 1) % cells, y1 = (y0 + 1) % cells;
      const a = lat[y0 % cells * cells + x0 % cells], b = lat[y0 % cells * cells + x1], c = lat[y1 * cells + x0 % cells], d = lat[y1 * cells + x1];
      let v = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
      if (ridged) v = 1 - Math.abs(v * 2 - 1);
      h[y * size + x] += v * amp;
    }
  }
  const data = new Uint8Array(size * size * 4), strength = 5.5;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = h[y * size + (x + 1) % size] - h[y * size + (x + size - 1) % size], dy = h[((y + 1) % size) * size + x] - h[((y + size - 1) % size) * size + x];
    const n = new THREE.Vector3(-dx * strength, -dy * strength, 1).normalize();
    data.set([(n.x * 0.5 + 0.5) * 255, (n.y * 0.5 + 0.5) * 255, (n.z * 0.5 + 0.5) * 255, 255], (y * size + x) * 4);
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true;
  return t;
}

/** Give a water material depth: shallow water over the ground is pale and see-through with foam at the shore, deep water is dark and almost opaque, and the ripples
 *  are two layers of the normal map moving across each other in world space (so they look the same on the sea and on a moat, and never repeat in an obvious grid).
 *  Works for a plane and for instanced discs. */
/** Clip all surfaces to the actual terrain triangles so earthworks move the shoreline without changing the water. */
export function patchWater(mat: THREE.MeshStandardMaterial, src: DepthSource, time: { value: number }, instanced: boolean, solid = false, seaLevel?: { value: number }) {
  const naturalWater = !solid || seaLevel !== undefined;
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = time; sh.uniforms.uGround = { value: src.heightTex }; sh.uniforms.uHalf = { value: src.half }; sh.uniforms.uStep = { value: src.step }; sh.uniforms.uNV = { value: src.nv };
    if (seaLevel) sh.uniforms.uSeaLevel = seaLevel;
    const tideUniform = seaLevel ? 'uniform float uSeaLevel;' : '';
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\nvarying vec3 vWP; ${tideUniform}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vWP = (modelMatrix * ${instanced ? 'instanceMatrix * ' : ''}vec4(transformed, 1.0)).xyz;
        ${seaLevel ? `float surface = max(uSeaLevel, vWP.y + uSeaLevel * (1.0 - smoothstep(0.0, 1.2, vWP.y)));
        transformed.y += surface - vWP.y; vWP.y = surface;` : ''}`);
    const normalChunk = THREE.ShaderChunk.normal_fragment_maps
      .replace('texture2D( normalMap, vNormalMapUv ).xyz', '(texture2D( normalMap, uvA ).xyz + texture2D( normalMap, uvB ).xyz) * 0.5');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWP; uniform float uTime; uniform sampler2D uGround; uniform float uHalf; uniform float uStep; uniform float uNV;
        ${tideUniform}
        float waterGround(vec2 worldXZ) {
          if (max(abs(worldXZ.x), abs(worldXZ.y)) >= uHalf) return -9.0;
          vec2 grid = clamp((worldXZ + uHalf) / uStep, vec2(0.0), vec2(uNV - 1.0));
          // Use the same NE–SW diagonal as the terrain mesh, including on the opposite bank.
          vec2 cell = min(floor(grid), vec2(uNV - 2.0));
          vec2 f = grid - cell;
          float dir = 1.0;
          if (f.x + f.y > 1.0) { cell += 1.0; f = 1.0 - f; dir = -1.0; }
          // Filter the two samples in the first row in hardware, then blend in the third vertex.
          vec2 row = cell + vec2(dir * f.x / max(1.0 - f.y, 0.0001), 0.0);
          float ab = texture2D(uGround, (row + 0.5) / uNV).r;
          float c = texture2D(uGround, (cell + vec2(0.0, dir) + 0.5) / uNV).r;
          return mix(ab, c, f.y);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float depth = vWP.y - waterGround(vWP.xz);
        if (depth <= 0.01) discard;
        float shoreCoverage = smoothstep(0.01, 0.06, depth);
        vec2 uvA = vWP.xz * 0.16 + vec2(uTime * 0.0045, uTime * 0.0031);
        vec2 uvB = mat2(0.8, -0.6, 0.6, 0.8) * vWP.xz * 0.43 + vec2(-uTime * 0.0072, uTime * 0.0108);
        float shallow = exp(-depth * 0.62);
        vec3 deepC = vec3(0.055, 0.215, 0.33), midC = vec3(0.10, 0.36, 0.46), shoreC = vec3(0.34, 0.66, 0.66);
        vec3 wc = mix(mix(deepC, midC, 1.0 - smoothstep(1.2, 5.0, depth)), shoreC, shallow * 0.85);
        float nz = texture2D(normalMap, vWP.xz * 0.09 + vec2(uTime * 0.006, -uTime * 0.004)).g;
        float edge = 1.0 - smoothstep(0.0, 0.65, depth + (nz - 0.5) * 0.5 + 0.12 * sin(uTime * 1.4 + vWP.x * 0.7 + vWP.z * 0.5));
        float crest = smoothstep(0.78, 0.96, texture2D(normalMap, uvA * 2.1).g) * (1.0 - smoothstep(0.4, 2.2, depth)) * 0.35;
        float foam = clamp(edge * smoothstep(0.35, 0.7, nz + 0.25) + crest, 0.0, 1.0);
        diffuseColor.rgb = mix(wc, vec3(0.93, 0.97, 0.98), foam * 0.82 * shoreCoverage);
        ${naturalWater ? `float seaAlpha = clamp(mix(0.985, 0.42, shallow) * smoothstep(0.0, 0.1, depth + 0.05) + foam * 0.7, 0.0, 1.0);
        seaAlpha = mix(seaAlpha, 1.0, smoothstep(4.5, 7.5, depth));
        ${seaLevel ? 'seaAlpha = mix(seaAlpha, 1.0, smoothstep(0.0, 0.55, vWP.y - uSeaLevel));' : ''}
        diffuseColor.a = seaAlpha * shoreCoverage;` : 'diffuseColor.a = 1.0;'}`)
      .replace('#include <normal_fragment_maps>', normalChunk);
  };
  // Each material binds its own uniforms. The program can be reused by surfaces with the same shader variant.
  mat.customProgramCacheKey = () => `water:${instanced}:${solid}:${!!seaLevel}`;
  mat.needsUpdate = true;
}
