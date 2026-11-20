import * as THREE from 'three';
import type { Terrain } from './terrain';
import { triangleHeight } from './rivergrid.ts';

interface Piece { x: number; z: number; reach: number; level: number; river: boolean }

/** Build one mesh per basin within a shared buffer. A still basin uses exactly one height. */
export function moatSurface(flat: ArrayLike<number>, step: number, carvedRivers?: ArrayLike<boolean>) {
  const pieces: Piece[] = [];
  for (let i = 0; i + 3 < flat.length; i += 4) {
    const [x, z, reach, level] = [flat[i], flat[i + 1], flat[i + 2], flat[i + 3]];
    if (reach > 0 && [x, z, reach, level].every(Number.isFinite)) pieces.push({ x, z, reach, level, river: carvedRivers?.[i / 4] === true });
  }
  const parents = pieces.map((_, i) => i);
  const root = (index: number) => {
    while (parents[index] !== index) { parents[index] = parents[parents[index]]; index = parents[index]; }
    return index;
  };
  pieces.forEach((p, i) => {
    for (let j = 0; j < i; j++) {
      const q = pieces[j];
      if ((p.x - q.x) ** 2 + (p.z - q.z) ** 2 <= (p.reach + q.reach) ** 2) parents[root(i)] = root(j);
    }
  });
  const basins = new Map<number, Piece[]>();
  pieces.forEach((p, i) => {
    const key = root(i), basin = basins.get(key);
    if (basin) basin.push(p); else basins.set(key, [p]);
  });
  const positions: number[] = [], indices: number[] = [];
  const heights = [...basins.values()].map(basin => {
    const cells = new Set<string>(), vertices = new Map<string, number>();
    const first = positions.length / 3, weights: number[] = [], fixed: boolean[] = [];
    const standingLevel = basin.reduce((level, p) => p.river ? level : Math.min(p.level, level), Infinity);
    const vertex = (i: number, j: number) => {
      const key = i + ':' + j, existing = vertices.get(key);
      if (existing !== undefined) return existing;
      const index = positions.length / 3;
      positions.push(i * step, 0, j * step); weights.push(0); fixed.push(false);
      vertices.set(key, index);
      return index;
    };
    for (const p of basin) {
      const { x, z, reach, level, river } = p, touched = new Set<number>();
      for (let i = Math.ceil((x - reach) / step); i <= Math.floor((x + reach) / step); i++) {
        for (let j = Math.ceil((z - reach) / step); j <= Math.floor((z + reach) / step); j++) {
          if ((i * step - x) ** 2 + (j * step - z) ** 2 >= reach ** 2) continue;
          // Cover all terrain triangles that touch the cut. The shader clips them against the bank.
          for (let di = -1; di <= 0; di++) for (let dj = -1; dj <= 0; dj++) {
            const a = i + di, b = j + dj, key = a + ':' + b;
            const nw = vertex(a, b), sw = vertex(a, b + 1), ne = vertex(a + 1, b), se = vertex(a + 1, b + 1);
            touched.add(nw); touched.add(ne); touched.add(sw); touched.add(se);
            if (!cells.has(key)) { cells.add(key); indices.push(nw, sw, ne, ne, sw, se); }
          }
        }
      }
      for (const index of touched) {
        const local = index - first;
        if (!river) { fixed[local] = true; continue; }
        const at = index * 3, distance = Math.hypot(positions[at] - x, positions[at + 2] - z);
        const weight = 1 / (1 + (distance / (reach * 0.42)) ** 4);
        positions[at + 1] += level * weight; weights[local] += weight;
      }
    }
    weights.forEach((weight, i) => {
      const at = (first + i) * 3 + 1;
      positions[at] = fixed[i] ? standingLevel : positions[at] / weight;
    });

    return (i: number, j: number, dx: number, dz: number) => {
      if (!cells.has(i + ':' + j)) return -Infinity;
      const at = (a: number, b: number) => positions[vertices.get(a + ':' + b)! * 3 + 1];
      return triangleHeight(at(i, j), at(i + 1, j), at(i, j + 1), at(i + 1, j + 1), dx, dz);
    };
  });
  const levelAt = (x: number, z: number) => {
    const gx = x / step, gz = z / step, i = Math.floor(gx), j = Math.floor(gz);
    let level = -Infinity;
    for (const at of heights) level = Math.max(level, at(i, j, gx - i, gz - j));
    return level;
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
    const material = terrain.makeWaterMaterial('channel');
    material.normalScale.set(0.26, 0.26);
    material.clearcoat = 0.15;
    material.polygonOffset = true; material.polygonOffsetFactor = -1; material.polygonOffsetUnits = -1;
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.mesh.receiveShadow = false;
    this.group.add(this.mesh);
  }

  /** `flat` is World.moat_water_flat(): [x, z, reach, level] per moat or carved river piece. */
  update(flat: Float32Array, buildings: Float32Array) {
    const carvedRivers: boolean[] = [];
    for (let i = 0; i < buildings.length; i += 10) if (buildings[i] === 24 || buildings[i] === 32) carvedRivers.push(buildings[i] === 32);
    const sig = flat.join(',') + '|' + carvedRivers.map(Number).join('');
    if (sig === this.sig) return; this.sig = sig;
    const { positions, indices, levelAt } = moatSurface(flat, this.terrainStep, carvedRivers);
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
