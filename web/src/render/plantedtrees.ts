import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Terrain } from './terrain';

/** Ticks a planted tree takes to grow up (the core's `forestry::GROW_TICKS`: a day and a half). */
export const GROW_TICKS = 360;
const MAX = 1600;

/** One small broadleaf tree with its colours in the vertices. */
function treeGeometry() {
  const paint = (g: THREE.BufferGeometry, hex: number, lo: number, hi: number) => {
    const g2 = g.index ? g.toNonIndexed() : g, p = g2.attributes.position, c = new THREE.Color(hex), a = new Float32Array(p.count * 3);
    let y0 = Infinity, y1 = -Infinity; for (let i = 0; i < p.count; i++) { y0 = Math.min(y0, p.getY(i)); y1 = Math.max(y1, p.getY(i)); }
    for (let i = 0; i < p.count; i++) { const t = lo + (hi - lo) * (p.getY(i) - y0) / Math.max(0.01, y1 - y0); a.set([c.r * t, c.g * t, c.b * t], i * 3); }
    g2.setAttribute('color', new THREE.BufferAttribute(a, 3)); g2.deleteAttribute('uv'); return g2;
  };
  const parts = [
    paint(new THREE.CylinderGeometry(0.14, 0.24, 2.2, 6).translate(0, 1.1, 0), 0x5a4129, 0.8, 1.1),
    paint(new THREE.IcosahedronGeometry(1.35, 1).scale(1, 0.9, 1).translate(0, 3.1, 0), 0x3f7d3a, 0.7, 1.25),
    paint(new THREE.IcosahedronGeometry(0.95, 1).translate(0.55, 3.9, 0.2), 0x4c8c42, 0.8, 1.3),
    paint(new THREE.IcosahedronGeometry(0.85, 1).translate(-0.6, 2.7, -0.35), 0x366f35, 0.75, 1.2),
  ];
  const g = mergeGeometries(parts)!; g.computeVertexNormals(); return g;
}

/** The trees the player (or a forester) planted in one village: they start as saplings and grow to full size. */
export class PlantedTrees {
  group = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private flat: ArrayLike<number> = [];
  private ground: number[] = [];
  private young = false; private lastTick = -Infinity;
  private dummy = new THREE.Object3D();

  constructor(private terrain: Terrain) {
    this.mesh = new THREE.InstancedMesh(treeGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: false }), MAX);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
  }

  /** The planted trees as [x, y, tick planted] each (the core's `planted_flat`), at game tick `tick`. */
  set(flat: ArrayLike<number>, tick: number) {
    this.flat = flat; const n = Math.min(MAX, Math.floor(flat.length / 3));
    this.ground = []; for (let i = 0; i < n; i++) this.ground.push(this.terrain.heightAt(flat[i * 3], flat[i * 3 + 1], true));
    this.lastTick = -Infinity; this.refresh(tick);
  }

  /** Grow the saplings: cheap, and only while a young tree is standing (called every tick, works about twice a game minute). */
  refresh(tick: number) {
    if (tick - this.lastTick < 12 && tick >= this.lastTick) return;
    if (!this.young && tick >= this.lastTick && this.lastTick > -Infinity) { this.lastTick = tick; return; }
    this.lastTick = tick;
    const n = Math.min(MAX, Math.floor(this.flat.length / 3)); let young = false;
    for (let i = 0; i < n; i++) {
      const x = this.flat[i * 3], z = this.flat[i * 3 + 1], age = (tick - this.flat[i * 3 + 2]) / GROW_TICKS;
      const grown = Math.min(1, Math.max(0, age)); if (grown < 1) young = true;
      const jitter = 0.85 + 0.3 * ((Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1 + 1) % 1;
      const s = (0.18 + 0.82 * Math.pow(grown, 0.8)) * jitter * 0.9;
      this.dummy.position.set(x, this.ground[i], z); this.dummy.rotation.set(0, (x * 7.3 + z * 3.1) % 6.28, 0); this.dummy.scale.set(s, s, s); this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.count = n; this.mesh.instanceMatrix.needsUpdate = true; this.young = young;
  }

  dispose() { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); this.mesh.dispose(); }
}
