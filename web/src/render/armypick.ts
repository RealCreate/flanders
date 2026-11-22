import * as THREE from 'three';

const body = (width: number, height: number, back: number, front = back) => new THREE.Box3(
  new THREE.Vector3(-width, -0.08, -back), new THREE.Vector3(width, height, front),
);
const bounds = {
  foot: body(0.48, 1.95, 0.4),
  mounted: body(0.65, 2.75, 0.95, 1.35),
  engine: body(1.03, 2.35, 1.8, 2.25),
  pole: body(0.2, 4.6, 0.2),
  flag: new THREE.Box3(new THREE.Vector3(-1.0, -0.65, -0.1), new THREE.Vector3(1.0, 0.65, 0.1)),
};

/** Pick from the drawn positions of instanced troops without adding a mesh for each soldier. */
export class ArmyPicker {
  private local = new THREE.Ray();
  private point = new THREE.Vector3();
  hit: { id: number; distance: number } | null = null;

  constructor(private ray: THREE.Ray) {}

  test(id: number, x: number, y: number, z: number, yaw: number, kind: keyof typeof bounds) {
    const { origin, direction } = this.ray;
    const c = Math.cos(yaw), s = Math.sin(yaw), dx = origin.x - x, dz = origin.z - z;
    this.local.origin.set(dx * c - dz * s, origin.y - y, dx * s + dz * c);
    this.local.direction.set(direction.x * c - direction.z * s, direction.y, direction.x * s + direction.z * c);
    const hit = this.local.intersectBox(bounds[kind], this.point);
    if (!hit) return;
    const distance = this.local.origin.distanceTo(hit);
    if (!this.hit || distance < this.hit.distance) this.hit = { id, distance };
  }
}
