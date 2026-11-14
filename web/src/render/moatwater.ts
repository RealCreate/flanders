import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Terrain } from './terrain';

/** The water of the moats. The ditch is dug deep so the water reads as deep, but the sea is at height 0 and a castle stands several units higher, so the sea plane alone would leave the
 *  moat's water far below the brim. Each moat piece gets a disc of water at the level the core works out (just under the rim of the land, smoothed between pieces); where the land is higher
 *  than the disc the land hides it, so only the ditch fills. One merged mesh per village, rebuilt only when the moat changes. */
export class MoatWater {
  group = new THREE.Group();
  private mesh: THREE.Mesh;
  private sig = '';

  constructor(terrain: Terrain) {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), terrain.makeWaterMaterial());
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 1; this.mesh.receiveShadow = false;
    this.group.add(this.mesh);
  }

  /** `flat` is World.moat_water_flat(): [x, z, reach, level] per piece. */
  update(flat: Float32Array) {
    const sig = Array.from(flat).map(v => v.toFixed(1)).join(',');
    if (sig === this.sig) return; this.sig = sig;
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i + 3 < flat.length; i += 4) {
      const g = new THREE.CircleGeometry(flat[i + 2] + 0.6, 24).rotateX(-Math.PI / 2);   // a little wider than the ditch: the land hides what is not in it
      g.translate(flat[i], flat[i + 3], flat[i + 1]); parts.push(g);
    }
    this.mesh.geometry.dispose();
    this.mesh.geometry = parts.length ? mergeGeometries(parts)! : new THREE.BufferGeometry();
  }

  dispose() { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}
