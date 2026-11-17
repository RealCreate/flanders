import * as THREE from 'three';
import type { Terrain } from './terrain';

/**
 * The road anchors of the building being placed: its own node ring(s) at the exact place (and for the turn) the building would get them, the short stub of road from its door to the node,
 * and the existing nodes or roads such a node would join (the ones a road end snaps to). The positions come from the core (World.node_preview, door_info), so the ghost cannot drift from the built node.
 */

/** Where the building's door is in the world, from its door in the model's frame ([door x, door z, ...] of door_info) at (x, z) turned by `rot` quarter-eighths (the core's `doors::to_world`). */
export function doorInWorld(info: ArrayLike<number>, x: number, z: number, rot: number): { x: number; z: number } {
  const th = (rot & 7) * Math.PI / 4, c = Math.cos(th), s = Math.sin(th);
  return { x: x + info[0] * c + info[1] * s, z: z + (-info[0] * s + info[1] * c) };
}

/** What to draw for one ghost: the node rings, and the stub from the door to the first node (none for kinds without a door). */
export interface AnchorShape { rings: { x: number; z: number }[]; stub: { x0: number; z0: number; x1: number; z1: number } | null }

/** `nodes` is the flat [x, z, ...] of node_preview (or of a bridge preview); `door` is the door's world place when the kind has a stub. */
export function anchorShape(nodes: ArrayLike<number>, door: { x: number; z: number } | null): AnchorShape {
  const rings: { x: number; z: number }[] = [];
  for (let i = 0; i + 1 < nodes.length; i += 2) rings.push({ x: nodes[i], z: nodes[i + 1] });
  const far = door && rings.length > 0 && Math.hypot(rings[0].x - door.x, rings[0].z - door.z) > 0.3;
  return { rings, stub: far ? { x0: door!.x, z0: door!.z, x1: rings[0].x, z1: rings[0].z } : null };
}

const MAX = 4;

export class AnchorGhost {
  group = new THREE.Group();
  private rings: THREE.Mesh[] = [];
  private lit: THREE.Mesh[] = [];
  private stub: THREE.Mesh;

  private terrain: Terrain;

  constructor(terrain: Terrain) {
    this.terrain = terrain;
    const mk = (color: number, geo: THREE.BufferGeometry, order: number) => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 }));
      m.visible = false; m.renderOrder = order; m.frustumCulled = false; this.group.add(m); return m;
    };
    const ringGeo = new THREE.RingGeometry(0.62, 0.95, 28).rotateX(-Math.PI / 2), litGeo = new THREE.RingGeometry(1.15, 1.5, 28).rotateX(-Math.PI / 2);
    for (let i = 0; i < MAX; i++) { this.rings.push(mk(0x66ff88, ringGeo, 10)); this.lit.push(mk(0xffe08a, litGeo, 11)); }
    this.stub = mk(0x66ff88, new THREE.PlaneGeometry(1, 0.34).rotateX(-Math.PI / 2), 10);
    this.group.visible = true;
  }

  /** Show the anchors of a ghost; `joins` are the places (existing nodes or roads) the new nodes would snap onto, `ok` colours it green or red. */
  show(shape: AnchorShape, joins: ({ x: number; z: number } | null)[], ok: boolean) {
    const col = ok ? 0x66ff88 : 0xff6655;
    for (let i = 0; i < MAX; i++) {
      const r = shape.rings[i], j = joins[i], m = this.rings[i], l = this.lit[i];
      if (!r) { m.visible = false; l.visible = false; continue; }
      m.visible = true; m.position.set(r.x, this.terrain.heightAt(r.x, r.z) + 0.2, r.z); (m.material as THREE.MeshBasicMaterial).color.setHex(col);
      l.visible = !!j; if (j) l.position.set(j.x, this.terrain.heightAt(j.x, j.z) + 0.22, j.z);
    }
    const s = shape.stub;
    if (s) {
      const len = Math.hypot(s.x1 - s.x0, s.z1 - s.z0), cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2;
      this.stub.visible = true; this.stub.scale.set(len, 1, 1); this.stub.rotation.y = -Math.atan2(s.z1 - s.z0, s.x1 - s.x0);
      this.stub.position.set(cx, this.terrain.heightAt(cx, cz) + 0.2, cz); (this.stub.material as THREE.MeshBasicMaterial).color.setHex(col);
    } else this.stub.visible = false;
  }

  hide() { for (const m of [...this.rings, ...this.lit, this.stub]) m.visible = false; }

  dispose() { this.rings[0].geometry.dispose(); this.lit[0].geometry.dispose(); this.stub.geometry.dispose(); }
}
