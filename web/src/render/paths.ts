import * as THREE from 'three';
import type { Terrain } from './terrain';
import { buildRoadMesh } from './roadmesh';
import { roadMaterialFor, roadHalfWidth, roadPixels, type RoadMaterial } from './roadlook';

const S = 10; // buildings_flat stride

function roadTexture(m: RoadMaterial) {
  const size = 128, t = new THREE.DataTexture(roadPixels(m, size), size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.needsUpdate = true; return t;
}

/** The roads (the stubs of the buildings and the roads the player laid), an apron under every building, and a paved square around the town hall: dirt while the castle is small, cobbled stone from tier 2 (roadlook.ts). */
export class Paths {
  group = new THREE.Group();
  private tracks: THREE.Mesh;
  private mat = new THREE.MeshStandardMaterial({ map: roadTexture('dirt'), vertexColors: true, transparent: true, roughness: 1, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });

  private textures: Record<RoadMaterial, THREE.Texture> = { dirt: this.mat.map!, stone: roadTexture('stone') };
  /** The material the roads have now (the whole village at once). */
  material: RoadMaterial = 'dirt';
  private uTick = { value: 1e9 };

  /** The game tick: roads grow in from the village centre over one day (240 ticks). */
  setTick(t: number) { this.uTick.value = t; }

  constructor(private terrain: Terrain) {
    this.mat.onBeforeCompile = sh => {
      sh.uniforms.uTick = this.uTick;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aRoad;\nvarying vec3 vRoad;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoad = aRoad;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTick;\nvarying vec3 vRoad;').replace('#include <color_fragment>', `#include <color_fragment>
        float grow = clamp((uTick - vRoad.x) / 240.0, 0.0, 1.0);
        diffuseColor.a *= 1.0 - smoothstep(grow * 1.2 - 0.2, grow * 1.2, vRoad.y);
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
    const hallTier = buildings[1] ?? 0, kindOfRoad = roadMaterialFor(hallTier);
    if (kindOfRoad !== this.material) { this.material = kindOfRoad; this.mat.map = this.textures[kindOfRoad]; }   // every road changes at once
    const y = (x: number, z: number) => { const h = this.terrain.heightAt(x, z), sl = Math.max(Math.abs(this.terrain.heightAt(x + 0.8, z) - h), Math.abs(this.terrain.heightAt(x, z + 0.8) - h)); return h + 0.09 + Math.min(0.14, sl * 0.25); };   // (a little higher on a slope, so the ground's own triangles never cut through)
    const vert = (x: number, z: number, a: number, u: number, v: number) => {
      const n = 0.94 + 0.06 * Math.sin(x * 1.7 + z * 2.3);
      pos.push(x, y(x, z), z); col.push(n, n, n, a); uv.push(u, v); rd.push(rb, rs, rp);
      return pos.length / 3 - 1;
    };
    // roads and stubs: ribbons along the curves, round patches at the ends and junctions (roadmesh.ts); the same dirt (and paving, in time) as always
    const rm = buildRoadMesh(roadLines, roadHalfWidth(hallTier)), base0 = pos.length / 3;
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
