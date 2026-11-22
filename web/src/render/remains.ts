import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Blood stains and ribcages left by the dead (soldiers and animals). Purely visual: one instanced stain mesh and one instanced ribcage mesh, capped. */
export const MAX_REMAINS = 160;

function ribcage(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const spine = new THREE.BoxGeometry(0.06, 0.05, 0.9); spine.translate(0, 0.05, 0); parts.push(spine);
  for (let k = -3; k <= 3; k++) {
    const rib = new THREE.TorusGeometry(0.2, 0.017, 4, 8, Math.PI);   // a half-hoop arching over the spine
    rib.translate(0, 0.02, k * 0.12); parts.push(rib);
  }
  const skull = new THREE.SphereGeometry(0.1, 6, 5); skull.translate(0, 0.09, 0.55); parts.push(skull);
  return mergeGeometries(parts)!;
}

export class Remains {
  group = new THREE.Group();
  private stains: THREE.InstancedMesh; private bones: THREE.InstancedMesh;
  private ns = 0; private nb = 0;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private p = new THREE.Vector3(); private s = new THREE.Vector3();
  constructor() {
    const disc = new THREE.CircleGeometry(0.5, 10); disc.rotateX(-Math.PI / 2);
    this.stains = new THREE.InstancedMesh(disc, new THREE.MeshBasicMaterial({ color: 0x4a1210, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), MAX_REMAINS);
    this.bones = new THREE.InstancedMesh(ribcage(), new THREE.MeshStandardMaterial({ color: 0xe6dcc4, roughness: 0.9, side: THREE.DoubleSide }), MAX_REMAINS);
    for (const m of [this.stains, this.bones]) { m.frustumCulled = false; m.count = 0; this.group.add(m); }
    this.bones.castShadow = true;
  }
  begin() { this.ns = this.nb = 0; }
  /** y: ground height; size: body length scale (1 = a person); stain 0..1; bones 0..1; fade 0..1 (sinking). */
  add(x: number, y: number, z: number, yaw: number, size: number, d: { stain: number; bones: number; fade: number }) {
    if (this.ns >= MAX_REMAINS) return;
    if (d.stain > 0.01) {
      this.e.set(0, yaw, 0); this.q.setFromEuler(this.e); this.p.set(x, y + 0.03, z); const r = (1.1 + size * 0.5) * d.stain; this.s.set(r, 1, r * 0.8);
      this.stains.setMatrixAt(this.ns++, this.m.compose(this.p, this.q, this.s));
    }
    if (d.bones > 0.01 && this.nb < MAX_REMAINS) {
      this.e.set(0, yaw, 0); this.q.setFromEuler(this.e); this.p.set(x, y + 0.02 - d.fade * 0.15, z); const k = size * (0.4 + 0.6 * d.bones); this.s.set(k, k * d.bones, k);
      this.bones.setMatrixAt(this.nb++, this.m.compose(this.p, this.q, this.s));
    }
  }
  end() {
    this.stains.count = this.ns; this.bones.count = this.nb;
    this.stains.instanceMatrix.needsUpdate = this.bones.instanceMatrix.needsUpdate = true;
  }
}
