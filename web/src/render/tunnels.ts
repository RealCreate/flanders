import * as THREE from 'three';
import type { Terrain } from './terrain';

/** Tunnels bored through the mountain ridges: a stone portal at each end, a dark opening and a short paved approach. The way between the portals is
 *  always passable for armies and caravans whatever the mountain does above it (see the core's pathfinding). */
export class Tunnels {
  group = new THREE.Group();
  /** [x0, z0, x1, z1] per tunnel. */
  readonly list: [number, number, number, number][] = [];

  constructor(private terrain: Terrain, flat: ArrayLike<number>) {
    for (let i = 0; i + 3 < flat.length; i += 4) this.list.push([flat[i], flat[i + 1], flat[i + 2], flat[i + 3]]);
    const stone = new THREE.MeshStandardMaterial({ color: 0x8c877d, roughness: 1 }), dark = new THREE.MeshStandardMaterial({ color: 0x050403, roughness: 1 }), wood = new THREE.MeshStandardMaterial({ color: 0x5a4028, roughness: 0.9 }), road = new THREE.MeshStandardMaterial({ color: 0x8f7d62, roughness: 1 });
    for (const [x0, z0, x1, z1] of this.list) {
      const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l;
      this.portal(x0, z0, -ux, -uz, stone, dark, wood, road);   // faces away from the tunnel, so out along the way in
      this.portal(x1, z1, ux, uz, stone, dark, wood, road);
    }
    this.group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = m.receiveShadow = true; } });
  }

  /** A portal at (x, z) looking out along (fx, fz). */
  private portal(x: number, z: number, fx: number, fz: number, stone: THREE.Material, dark: THREE.Material, wood: THREE.Material, road: THREE.Material) {
    const g = new THREE.Group(), y = this.terrain.heightAt(x, z);
    // the portal sits a little inside the slope so it reads as bored into the hill: a wide stone face, a dark arch, a lintel and two buttresses
    const face = new THREE.Mesh(new THREE.BoxGeometry(9, 6.2, 2.2), stone); face.position.set(0, 2.6, 0.2); g.add(face);
    const arch = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 2.6, 16, 1, false, 0, Math.PI), dark); arch.rotation.set(Math.PI / 2, 0, 0); arch.rotation.z = Math.PI / 2; arch.rotation.order = 'ZXY'; arch.position.set(0, 2.1, 1.35); g.add(arch);
    const hole = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.2, 2.7), dark); hole.position.set(0, 1.1, 1.3); g.add(hole);
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.5, 2.5), stone); lintel.position.set(0, 4.35, 1.4); g.add(lintel);
    for (const s of [-1, 1]) { const b = new THREE.Mesh(new THREE.BoxGeometry(1.0, 4.4, 2.6), stone); b.position.set(s * 2.9, 2.2, 1.4); g.add(b); const beam = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.7, 0.35), wood); beam.position.set(s * 2.25, 1.35, 2.35); g.add(beam); }
    const apron = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.12, 5), road); apron.position.set(0, 0.04, 4.2); g.add(apron);
    g.position.set(x - fx * 1.2, y - 0.2, z - fz * 1.2); g.rotation.y = Math.atan2(fx, fz);
    this.group.add(g);
  }

  dispose() { this.group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); }); }
}
