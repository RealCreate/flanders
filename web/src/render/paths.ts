import * as THREE from 'three';
import type { Terrain } from './terrain';
import { buildRoadMesh } from './roadmesh';

const S = 10; // buildings_flat stride

function dirtTexture() {
  const s = 128, c = document.createElement('canvas'); c.width = c.height = s; const g = c.getContext('2d')!;
  g.fillStyle = '#b9a07a'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 900; i++) { const v = Math.random(); g.fillStyle = v > 0.5 ? `rgba(255,240,210,${Math.random() * 0.25})` : `rgba(60,40,20,${Math.random() * 0.3})`; g.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 3, 1 + Math.random() * 2); }
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(110,100,90,${0.25 + Math.random() * 0.3})`; g.beginPath(); g.ellipse(Math.random() * s, Math.random() * s, 1 + Math.random() * 3, 1 + Math.random() * 2, Math.random() * 3, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

const TIER_COLOR = [new THREE.Color(0xb59468), new THREE.Color(0xbfb09a), new THREE.Color(0xb7b2a8), new THREE.Color(0xc2beb4)];

/** The dirt of the roads (the stubs of the buildings and the roads the player laid), an apron under every building, and a paved square around the town hall. */
export class Paths {
  group = new THREE.Group();
  private tracks: THREE.Mesh;
  private mat = new THREE.MeshStandardMaterial({ map: dirtTexture(), vertexColors: true, transparent: true, roughness: 1, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });

  private uTick = { value: 1e9 };

  /** The game tick: roads grow in from the village centre over one day (240 ticks) and are paved, slowly, over the days after. */
  setTick(t: number) { this.uTick.value = t; }

  constructor(private terrain: Terrain) {
    this.mat.onBeforeCompile = sh => {
      sh.uniforms.uTick = this.uTick;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aRoad;\nvarying vec3 vRoad;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoad = aRoad;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTick;\nvarying vec3 vRoad;').replace('#include <color_fragment>', `#include <color_fragment>
        float grow = clamp((uTick - vRoad.x) / 240.0, 0.0, 1.0);
        diffuseColor.a *= 1.0 - smoothstep(grow * 1.2 - 0.2, grow * 1.2, vRoad.y);
        float pv = clamp((uTick - vRoad.x - 360.0) / 900.0, 0.0, 1.0) * min(vRoad.z, 1.0);
        float paved = (1.0 - smoothstep(pv * 1.15 - 0.15, pv * 1.15, vRoad.y)) * step(0.001, pv);
        vec2 cu = vMapUv * 5.0; float cob = step(0.1, fract(cu.x)) * step(0.1, fract(cu.y + floor(cu.x) * 0.5));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.64, 0.62, 0.58) * (0.78 + 0.22 * cob), paved * 0.92);
`);
    };
    this.mat.customProgramCacheKey = () => 'paths' + this.mat.id;   // one program per village: each has its own clock uniform (see patchWater)
    this.tracks = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
    this.tracks.receiveShadow = true; this.tracks.renderOrder = 2; this.tracks.frustumCulled = false;
    this.group.add(this.tracks);
  }

  /** Rebuild from the world: buildings_flat (stride 10), the road lines (World.road_lines_flat: the stub of every building and the roads the player laid, see roadmesh.ts), building radii and the birth ticks. */
  update(buildings: Float32Array, roadLines: ArrayLike<number>, radii: number[], born: ArrayLike<number> = []) {
    void born;
    const pos: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = [], rd: number[] = [];
    let rb = -1e6, rs = 0, rp = 0;   // the road the next vertices belong to: birth tick, distance from the village end (0..1), paveable
    const hallTier = buildings[1] ?? 0, tone = TIER_COLOR[Math.min(3, hallTier)];
    const y = (x: number, z: number) => this.terrain.heightAt(x, z) + 0.09;
    const vert = (x: number, z: number, a: number, u: number, v: number) => {
      const n = 0.92 + 0.08 * Math.sin(x * 1.7 + z * 2.3);
      pos.push(x, y(x, z), z); col.push(tone.r * n, tone.g * n, tone.b * n, a); uv.push(u, v); rd.push(rb, rs, rp);
      return pos.length / 3 - 1;
    };
    // roads and stubs: ribbons along the curves, round patches at the ends and junctions (roadmesh.ts); the same dirt (and paving, in time) as always
    const rm = buildRoadMesh(roadLines, hallTier >= 2 ? 1.45 : 1.15), base0 = pos.length / 3;
    for (let k = 0; k < rm.x.length; k++) { rb = rm.born[k]; rs = rm.along[k]; rp = rm.pave[k]; vert(rm.x[k], rm.z[k], rm.a[k], rm.u[k], rm.v[k]); }
    for (const i of rm.idx) idx.push(base0 + i);
    rb = -1e6; rs = 0; rp = 0;
    // aprons under buildings (and the plaza under the hall)
    for (let i = 0; i < buildings.length; i += S) {
      const kind = buildings[i], x = buildings[i + 2], z = buildings[i + 3];
      if (kind === 2 || kind === 21 || kind === 22 || kind === 24 || kind === 32 || kind === 33 || kind === 34 || kind === 37 || kind === 38 || kind === 44) continue; // walls, fences, gates, moats and squares (which are paved themselves) have no apron
      const isHall = kind === 15; let R = isHall ? radii[kind] + 3.8 + hallTier * 0.8 : radii[kind] * 1.05 + 1.0; const rings = 5, seg = 28;
      for (let j = 0; j < buildings.length; j += S) {   // never under a neighbour: the apron stops short of the nearest other building
        const k2 = buildings[j]; if (j === i || k2 === 2 || k2 === 21 || k2 === 22 || k2 === 24 || k2 === 32 || k2 === 33 || k2 === 34 || k2 === 37 || k2 === 38 || k2 === 44) continue;
        R = Math.min(R, Math.max(radii[kind] * 0.8, Math.hypot(buildings[j + 2] - x, buildings[j + 3] - z) - radii[k2] * 0.9 - 0.3));
      }
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
    g.setIndex(idx);
    this.tracks.geometry.dispose(); this.tracks.geometry = g;
  }
}
