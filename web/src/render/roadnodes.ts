import * as THREE from 'three';
import type { Terrain } from './terrain';

/**
 * The connection nodes of the buildings (World.road_nodes_flat: [x, z, building, k] each): where the stub path of a building leaves its plot, and the four sides of a square.
 * A road you lay snaps onto them. They are small rings on the ground; while the road tool is in hand they are larger and brighter, and the one a road end would snap to is lit.
 */
export class RoadNodes {
  group = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private lit = new THREE.Mesh(new THREE.RingGeometry(0.75, 1.05, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.95, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
  private nodes: number[] = [];
  private active = false;
  private m = new THREE.Matrix4();

  constructor(private terrain: Terrain, max = 1200) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xf1e4c3, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
    this.mesh = new THREE.InstancedMesh(new THREE.RingGeometry(0.28, 0.5, 20).rotateX(-Math.PI / 2), mat, max);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.renderOrder = 4;
    this.lit.visible = false; this.lit.renderOrder = 5;
    this.group.add(this.mesh, this.lit);
  }

  update(flat: ArrayLike<number>) {
    this.nodes = Array.from(flat);
    this.layout();
  }

  /** The road tool is in hand: show the nodes larger. */
  setActive(on: boolean) { if (on === this.active) return; this.active = on; this.layout(); if (!on) this.lit.visible = false; }

  /** Light the node at (x, z), or none. */
  highlight(p: { x: number; z: number } | null) {
    if (!p) { this.lit.visible = false; return; }
    this.lit.visible = true; this.lit.position.set(p.x, this.terrain.heightAt(p.x, p.z) + 0.16, p.z);
  }

  private layout() {
    const n = Math.min(this.nodes.length / 4, this.mesh.instanceMatrix.count), s = this.active ? 2.1 : 1;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = this.active ? 0.95 : 0.5;
    for (let i = 0; i < n; i++) {
      const x = this.nodes[i * 4], z = this.nodes[i * 4 + 1];
      this.m.makeScale(s, 1, s).setPosition(x, this.terrain.heightAt(x, z) + 0.15, z); this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.count = n; this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() { this.mesh.geometry.dispose(); this.lit.geometry.dispose(); }
}
