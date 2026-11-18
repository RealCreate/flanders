import * as THREE from 'three';
import type { Terrain } from './terrain';

/** Cover every terrain cell that touches an excavated vertex. Adjacent moat pieces share the same water vertices. */
export function moatSurface(flat: ArrayLike<number>, step: number) {
  const cells = new Set<string>(), vertices = new Map<string, number>();
  const positions: number[] = [], indices: number[] = [];
  const vertex = (i: number, j: number, level: number) => {
    const key = i + ':' + j, existing = vertices.get(key);
    if (existing !== undefined) {
      const y = existing * 3 + 1;
      positions[y] = Math.min(positions[y], level);
      return existing;
    }
    const index = positions.length / 3;
    positions.push(i * step, level, j * step);
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
    for (const [key, [col, row]] of affected) {
      const a = vertex(col, row, level), b = vertex(col + 1, row, level);
      const c = vertex(col, row + 1, level), d = vertex(col + 1, row + 1, level);
      if (!cells.has(key)) { cells.add(key); indices.push(a, c, b, b, c, d); }
    }
  }
  return { positions, indices };
}

export class MoatWater {
  group = new THREE.Group();
  private mesh: THREE.Mesh;
  private sig = '';
  private terrainStep: number;

  constructor(terrain: Terrain, terrainStep: number) {
    this.terrainStep = terrainStep;
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), terrain.makeWaterMaterial(true));
    this.mesh.receiveShadow = false;
    this.group.add(this.mesh);
  }

  /** `flat` is World.moat_water_flat(): [x, z, reach, level] per piece. */
  update(flat: Float32Array) {
    const sig = flat.join(',');
    if (sig === this.sig) return; this.sig = sig;
    const { positions, indices } = moatSurface(flat, this.terrainStep);
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
