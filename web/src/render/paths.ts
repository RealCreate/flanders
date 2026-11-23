import * as THREE from 'three';
import type { Terrain } from './terrain';
import { buildRoadMesh } from './roadmesh';
import { ROAD_MATERIALS, ROAD_HALF, roadPixels, APRON_RGB, APRON_ALPHA } from './roadlook';

const S = 10; // buildings_flat stride
const TEX = 256;

/** The four surfaces as the layers of one array texture: dirt, gravel, cobbles, flagstones. The shader picks a layer (or two, and blends them where a road changes surface). */
function roadTextures(): THREE.DataArrayTexture {
  const layer = TEX * TEX * 4, data = new Uint8Array(layer * ROAD_MATERIALS.length);
  ROAD_MATERIALS.forEach((m, i) => data.set(roadPixels(m, TEX), i * layer));
  const t = new THREE.DataArrayTexture(data, TEX, TEX, ROAD_MATERIALS.length);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping;   // (across the road the edge is the edge; along it the pattern repeats)
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.needsUpdate = true; return t;
}

/** The roads (the stubs of the buildings and the roads the player laid), an apron under every building, and a paved square around the town hall. Every stretch of road has the surface the player gave it
 *  (dirt, gravel, cobbles, flagstones: roadlook.ts); where two surfaces meet, and at corners and junctions, the shader blends them with a ragged edge, and the verge is ragged too. */
export class Paths {
  group = new THREE.Group();
  private tracks: THREE.Mesh;
  private mat = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, roughness: 1, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });

  /** The trodden ground round a building: a faint plain earth tint, never the road's own material (a building is not standing on a cobbled road). */
  private apronMat = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, roughness: 1, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  private textures = roadTextures();
  private uTick = { value: 1e9 };

  /** The game tick: roads grow in from the village centre over one day (240 ticks). */
  setTick(t: number) { this.uTick.value = t; }

  constructor(private terrain: Terrain) {
    this.mat.onBeforeCompile = sh => {
      sh.uniforms.uTick = this.uTick; sh.uniforms.uRoadTex = { value: this.textures };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aRoad;\nvarying vec3 vRoad;\nvarying vec2 vRU;\nvarying vec2 vWP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoad = aRoad; vRU = uv; vWP = (modelMatrix * vec4(transformed, 1.0)).xz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        uniform float uTick; uniform highp sampler2DArray uRoadTex;
        varying vec3 vRoad; varying vec2 vRU; varying vec2 vWP;
        float rh21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float rvn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(rh21(i), rh21(i + vec2(1.0, 0.0)), f.x), mix(rh21(i + vec2(0.0, 1.0)), rh21(i + vec2(1.0, 1.0)), f.x), f.y); }
        float rnoise(vec2 p) { return rvn(p * 2.1) * 0.5 + rvn(p * 5.3 + 7.1) * 0.3 + rvn(p * 11.7 + 3.3) * 0.2; }`)
        .replace('#include <map_fragment>', `
        {
          // the surface: a layer of the array, or two blended along a ragged line where one surface runs into the next (the noise decides which layer wins at each place)
          float m = clamp(vRoad.z, 0.0, 3.0), i0 = floor(m), f = m - i0, i1 = min(i0 + 1.0, 3.0);
          float nz = rnoise(vWP);
          float w = smoothstep(0.30, 0.70, f + (nz - 0.5) * 0.62);
          vec3 t0 = texture(uRoadTex, vec3(vRU, i0)).rgb;
          vec3 t1 = texture(uRoadTex, vec3(vRU, i1)).rgb;
          diffuseColor.rgb *= mix(t0, t1, f > 0.001 ? w : 0.0);
        }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
        {   // the verge is ragged: the grass overlaps the road's soft edge unevenly, and the road is solid from there inwards
          float ea = clamp(diffuseColor.a / 0.95, 0.0, 1.0);
          float en = rnoise(vWP * 1.7 + 11.0);
          diffuseColor.a = 0.95 * smoothstep(0.10, 0.55, ea + (en - 0.5) * 0.55) * step(0.001, ea);
        }
        float grow = clamp((uTick - vRoad.x) / 240.0, 0.0, 1.0);
        diffuseColor.a *= 1.0 - smoothstep(grow * 1.2 - 0.2, grow * 1.2, vRoad.y);
`);
    };
    this.mat.customProgramCacheKey = () => 'paths' + this.mat.id;   // one program per village: each has its own clock uniform (see patchWater)
    this.tracks = new THREE.Mesh(new THREE.BufferGeometry(), [this.mat, this.apronMat]);
    this.tracks.receiveShadow = true; this.tracks.renderOrder = 2; this.tracks.frustumCulled = false;
    this.group.add(this.tracks);
  }

  /** Rebuild from the world: buildings_flat (stride 10), the road lines (World.road_lines_flat: the stub of every building and the roads the player laid, see roadmesh.ts), building radii and the birth ticks. */
  update(buildings: Float32Array, roadLines: ArrayLike<number>, radii: number[], born: ArrayLike<number> = []) {
    void born;
    const pos: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = [], rd: number[] = [];
    let tint = false;   // (declared before `vert`, which reads it: a `let` used before its line is a ReferenceError)
    let rb = -1e6, rs = 0, rp = 0;   // the road the next vertices belong to: birth tick, distance from the village end (0..1), surface (0 dirt .. 3 flagstones)
    const hallTier = buildings[1] ?? 0;
    const y = (x: number, z: number) => { const h = this.terrain.heightAt(x, z), sl = Math.max(Math.abs(this.terrain.heightAt(x + 0.8, z) - h), Math.abs(this.terrain.heightAt(x, z + 0.8) - h)); return h + 0.09 + Math.min(0.14, sl * 0.25); };   // (a little higher on a slope, so the ground's own triangles never cut through)
    const vert = (x: number, z: number, a: number, u: number, v: number) => {
      const n = 0.94 + 0.06 * Math.sin(x * 1.7 + z * 2.3);
      pos.push(x, y(x, z), z); if (tint) col.push(APRON_RGB[0] * n, APRON_RGB[1] * n, APRON_RGB[2] * n, a * APRON_ALPHA); else col.push(n, n, n, a); uv.push(u, v); rd.push(rb, rs, rp);
      return pos.length / 3 - 1;
    };
    // roads and stubs: ribbons along the curves, round patches at the ends and junctions (roadmesh.ts); the same dirt (and paving, in time) as always
    const rm = buildRoadMesh(roadLines, ROAD_HALF), base0 = pos.length / 3;
    for (let k = 0; k < rm.x.length; k++) { rb = rm.born[k]; rs = rm.along[k]; rp = rm.mat[k]; vert(rm.x[k], rm.z[k], rm.a[k], rm.u[k], rm.v[k]); }
    for (const i of rm.idx) idx.push(base0 + i);
    rb = -1e6; rs = 0; rp = 0;
    const roadIdx = idx.length;
    // aprons under buildings (and the plaza under the hall)
    for (let i = 0; i < buildings.length; i += S) {
      const kind = buildings[i], x = buildings[i + 2], z = buildings[i + 3];
      if (kind === 2 || kind === 21 || kind === 22 || kind === 24 || kind === 32 || kind === 33 || kind === 34 || kind === 37 || kind === 38 || kind === 44) continue; // walls, fences, gates, moats and squares (which are paved themselves) have no apron
      const isHall = kind === 15; let R = isHall ? (hallTier >= 3 ? 33 : radii[kind] + 3.8 + hallTier * 0.8) : radii[kind] * 1.05 + 1.0; const rings = 5, seg = 28;
      for (let j = 0; j < buildings.length; j += S) {   // never under a neighbour: the apron stops short of the nearest other building
        const k2 = buildings[j]; if (j === i || k2 === 2 || k2 === 21 || k2 === 22 || k2 === 24 || k2 === 32 || k2 === 33 || k2 === 34 || k2 === 37 || k2 === 38 || k2 === 44) continue;
        R = Math.min(R, Math.max(radii[kind] * 0.8, Math.hypot(buildings[j + 2] - x, buildings[j + 3] - z) - radii[k2] * 0.9 - 0.3));
      }
      tint = true;
      const base = pos.length / 3;
      vert(x, z, 0.95, 0.5, 0.5);
      for (let r = 1; r <= rings; r++) for (let k = 0; k < seg; k++) {
        const a = (k / seg) * Math.PI * 2, rr = (R * r) / rings, fade = r >= rings ? 0 : r === rings - 1 ? 0.55 : 0.95;
        vert(x + Math.cos(a) * rr, z + Math.sin(a) * rr, fade * (isHall ? 1 : 0.85), 0.5 + Math.cos(a) * (r / rings) * 0.5, 0.5 + Math.sin(a) * (r / rings) * 0.5);
      }
      for (let k = 0; k < seg; k++) idx.push(base, base + 1 + k, base + 1 + ((k + 1) % seg));
      for (let r = 1; r < rings; r++) for (let k = 0; k < seg; k++) {
        const a = base + 1 + (r - 1) * seg + k, b = base + 1 + (r - 1) * seg + ((k + 1) % seg), c = a + seg, d = b + seg;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute('aRoad', new THREE.Float32BufferAttribute(rd, 3));
    g.setIndex(idx); g.addGroup(0, roadIdx, 0); g.addGroup(roadIdx, idx.length - roadIdx, 1);
    this.tracks.geometry.dispose(); this.tracks.geometry = g;
  }
}
