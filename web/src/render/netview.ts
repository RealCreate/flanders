import * as THREE from 'three';
import type { Terrain } from './terrain';

/** The invisible path network, drawn as red lines (a display setting, for seeing where soldiers and villagers may walk). Roads are bright, the rest dark red. */
export class NetView {
  group = new THREE.Group();
  private lines: THREE.LineSegments;
  private sig = '';

  constructor(private terrain: Terrain) {
    this.lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, depthTest: false }));
    this.lines.frustumCulled = false; this.lines.renderOrder = 30; this.group.add(this.lines); this.group.visible = false;
  }

  /** `flat` is World.net_flat(): [n, e, x, y (n times), a, b, road (e times)]. Pass null to hide. */
  update(flat: Float32Array | null) {
    if (!flat) { this.group.visible = false; return; }
    this.group.visible = true;
    const n = flat[0], e = flat[1], sig = n + ':' + e + ':' + (flat[2] ?? 0) + ':' + (flat[flat.length - 1] ?? 0) + ':' + (flat[2 + 2 * n + 3 * Math.floor(e / 2)] ?? 0);
    if (sig === this.sig) return; this.sig = sig;
    const pos: number[] = [], col: number[] = [];
    for (let k = 0; k < e; k++) {
      const o = 2 + 2 * n + 3 * k, a = flat[o], b = flat[o + 1], road = flat[o + 2] > 0.5;
      for (const i of [a, b]) { const x = flat[2 + 2 * i], z = flat[3 + 2 * i]; pos.push(x, this.terrain.walkAt(x, z) + 0.5, z); if (road) col.push(1, 0.15, 0.1); else col.push(0.65, 0.05, 0.05); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.lines.geometry.dispose(); this.lines.geometry = g;
  }

  dispose() { this.lines.geometry.dispose(); (this.lines.material as THREE.Material).dispose(); }
}
