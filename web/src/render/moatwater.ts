import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Terrain } from './terrain';

/** The water of the moats. The ditch is dug deep so the water reads as deep, but the sea is at height 0 and a castle stands several units higher, so the sea plane alone would leave the
 *  moat's water far below the brim. Each moat piece gets a disc of water at the level the core works out (just under the rim of the land, smoothed between pieces); where the land is higher
 *  than the disc the land hides it, so only the ditch fills. One merged mesh per village, rebuilt only when the moat changes. */
/** The discs of water for World.moat_water_flat(): one per piece, [x, z, radius, level]. The radius is a little wider than the ditch (the land hides what is not in it); the core caps the level
 *  below the lowest bank round the piece, so a disc never rises above the ground at its rim. Pieces with a non-finite or negative reach are skipped. */
export function moatDiscs(flat: ArrayLike<number>): number[][] {
  const out: number[][] = [];
  for (let i = 0; i + 3 < flat.length; i += 4) { if (!(flat[i + 2] > 0) || !Number.isFinite(flat[i + 3])) continue; out.push([flat[i], flat[i + 1], flat[i + 2] + 0.6, flat[i + 3]]); }
  return out;
}

export class MoatWater {
  group = new THREE.Group();
  private mesh: THREE.Mesh;
  private sig = '';

  constructor(terrain: Terrain) {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), terrain.makeWaterMaterial(true));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 1; this.mesh.receiveShadow = false;
    this.group.add(this.mesh);
  }

  /** `flat` is World.moat_water_flat(): [x, z, reach, level] per piece. */
  update(flat: Float32Array) {
    const sig = Array.from(flat).map(v => v.toFixed(1)).join(',');
    if (sig === this.sig) return; this.sig = sig;
    const parts: THREE.BufferGeometry[] = [];
    for (const [x, z, r, y] of moatDiscs(flat)) { const g = new THREE.CircleGeometry(r, 24).rotateX(-Math.PI / 2); g.translate(x, y, z); parts.push(g); }
    this.mesh.geometry.dispose();
    this.mesh.geometry = parts.length ? mergeGeometries(parts)! : new THREE.BufferGeometry();
  }

  dispose() { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}
