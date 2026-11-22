import * as THREE from 'three';
import type { Camp } from '../camplayout';

/** The little tents an army pitches where it has stopped (see camplayout.ts for where). Geometry and cloth are shared by every camp; a camp is only a group of small groups, one per tent, so
 *  removing one never disposes anything. The tents rise out of the ground as the camp is made. */
const GEO = {
  tent: new THREE.ConeGeometry(1.7, 1.9, 4).rotateY(Math.PI / 4).translate(0, 0.95, 0),
  door: new THREE.PlaneGeometry(0.7, 1.05), pole: new THREE.CylinderGeometry(0.035, 0.035, 1.1, 4).translate(0, 0.55, 0), pennant: new THREE.PlaneGeometry(0.55, 0.3).translate(0.28, 0, 0),
  peg: new THREE.CylinderGeometry(0.04, 0.05, 0.4, 4).translate(0, 0.2, 0),
};
const MAT = {
  canvas: new THREE.MeshStandardMaterial({ color: 0xe6dcc0, roughness: 0.95, flatShading: true }),
  door: new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 1, side: THREE.DoubleSide }),
  wood: new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 0.9 }),
  pennant: new THREE.MeshStandardMaterial({ color: 0x2f5fa8, roughness: 0.8, side: THREE.DoubleSide }),
};

export class ArmyCamp {
  group = new THREE.Group();
  private tents: THREE.Group[] = [];

  private tent(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(GEO.tent, MAT.canvas); body.castShadow = true; body.receiveShadow = true;
    const door = new THREE.Mesh(GEO.door, MAT.door); door.position.set(0, 0.45, 0.78); door.rotation.x = -0.42;
    const pole = new THREE.Mesh(GEO.pole, MAT.wood); pole.position.y = 1.85;
    const pennant = new THREE.Mesh(GEO.pennant, MAT.pennant); pennant.position.y = 2.7; pennant.userData.pennant = true;
    g.add(body, door, pole, pennant); this.group.add(g); return g;
  }

  /** Put the first `count` tents where `camp` says, `grow` (0..1) of the way out of the ground, the pennants in `color` and fluttering with `t`. */
  show(camp: Camp, ground: (x: number, z: number) => number, grow: number, color: number, t: number, count = camp.tents.length) {
    MAT.pennant.color.setHex(color);
    while (this.tents.length < camp.tents.length) this.tents.push(this.tent());
    this.tents.forEach((g, i) => {
      const c = camp.tents[i], on = !!c && i < count && grow > 0.02;
      if (!on) { g.visible = false; g.userData.born = undefined; return; }
      if (!g.visible || g.userData.born === undefined) g.userData.born = t;   // each tent rises on its own, from the moment its turn comes
      g.visible = true;
      const k = Math.min(1, (t - g.userData.born) / 1.5);
      g.position.set(c.x, ground(c.x, c.z) - (1 - k) * 1.6, c.z); g.rotation.y = c.yaw; g.scale.setScalar(0.4 + 0.6 * k);
      const f = g.children[3]; f.rotation.y = Math.sin(t * 3 + i) * 0.35;
    });
    this.group.visible = true;
  }

  hide() { this.group.visible = false; }
}
