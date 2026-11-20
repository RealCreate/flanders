import * as THREE from 'three';
import type { Terrain } from './terrain';

/** Cover every terrain cell that touches an excavated vertex. Adjacent moat pieces share the same water vertices. */
export function moatSurface(flat: ArrayLike<number>, step: number) {
  const cells = new Set<string>(), vertices = new Map<string, number>();
  const positions: number[] = [], indices: number[] = [], weights: number[] = [];
  const vertex = (i: number, j: number) => {
    const key = i + ':' + j, existing = vertices.get(key);
    if (existing !== undefined) return existing;
    const index = positions.length / 3;
    positions.push(i * step, 0, j * step); weights.push(0);
    vertices.set(key, index);
    return index;
  };
  for (let i = 0; i + 3 < flat.length; i += 4) {
    const [x, z, reach, level] = [flat[i], flat[i + 1], flat[i + 2], flat[i + 3]];
    if (!(reach > 0) || ![x, z, reach, level].every(Number.isFinite)) continue;
    const affected = new Map<string, [number, number]>();
    for (let col = Math.ceil((x - reach) / step); col <= Math.floor((x + reach) / step); col++) {
      for (let row = Math.ceil((z - reach) / step); row <= Math.floor((z + reach) / step); row++) {
        if ((col * step - x) ** 2 + (row * step - z) ** 2 >= reach ** 2) continue;
        for (let dc = -1; dc <= 0; dc++) for (let dr = -1; dr <= 0; dr++) {
          affected.set((col + dc) + ':' + (row + dr), [col + dc, row + dr]);
        }
      }
    }
    const touched = new Set<number>();
    for (const [key, [col, row]] of affected) {
      const a = vertex(col, row), b = vertex(col + 1, row);
      const c = vertex(col, row + 1), d = vertex(col + 1, row + 1);
      touched.add(a); touched.add(b); touched.add(c); touched.add(d);
      if (!cells.has(key)) { cells.add(key); indices.push(a, c, b, b, c, d); }
    }
    for (const index of touched) {
      const at = index * 3, distance = Math.hypot(positions[at] - x, positions[at + 2] - z);
      const weight = 1 / (1 + (distance / (reach * 0.42)) ** 4);
      positions[at + 1] += level * weight; weights[index] += weight;
    }
  }
  weights.forEach((weight, i) => { positions[3 * i + 1] /= weight; });
  const levelAt = (x: number, z: number) => {
    const gx = x / step, gz = z / step, i = Math.floor(gx), j = Math.floor(gz);
    if (!cells.has(i + ':' + j)) return -Infinity;
    const at = (a: number, b: number) => positions[vertices.get(a + ':' + b)! * 3 + 1];
    const dx = gx - i, dz = gz - j, b = at(i + 1, j), c = at(i, j + 1);
    if (dx + dz <= 1) {
      const a = at(i, j);
      return a + (b - a) * dx + (c - a) * dz;
    }
    const d = at(i + 1, j + 1);
    return d + (c - d) * (1 - dx) + (b - d) * (1 - dz);
  };
  return { positions, indices, levelAt };
}

export class MoatWater {
  group = new THREE.Group();
  private mesh: THREE.Mesh;
  private sig = '';
  private terrainStep: number;
  levelAt: (x: number, z: number) => number = () => -Infinity;

  constructor(terrain: Terrain, terrainStep: number) {
    this.terrainStep = terrainStep;
    const material = terrain.makeWaterMaterial(true);
    material.polygonOffset = true; material.polygonOffsetFactor = -1; material.polygonOffsetUnits = -1;
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.mesh.receiveShadow = false;
    this.group.add(this.mesh);
  }

  /** `flat` is World.moat_water_flat(): [x, z, reach, level] per moat or carved river piece. */
  update(flat: Float32Array) {
    const sig = flat.join(',');
    if (sig === this.sig) return; this.sig = sig;
    const { positions, indices, levelAt } = moatSurface(flat, this.terrainStep);
    this.levelAt = levelAt;
    const mesh = new THREE.BufferGeometry();
    mesh.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const uv: number[] = [];
    for (let i = 0; i < positions.length; i += 3) uv.push(positions[i], positions[i + 2]);
    mesh.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    mesh.setIndex(indices);
    mesh.computeVertexNormals();
    this.mesh.geometry.dispose();
    this.mesh.geometry = mesh;
  }

  dispose() { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}
