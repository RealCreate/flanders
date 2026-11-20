const CHANNEL = 2;
const TIDE_MARGIN = 1;

/** Sample a grid cell split along its north-east to south-west diagonal. */
export function triangleHeight(a: number, b: number, c: number, d: number, dx: number, dz: number) {
  return dx + dz <= 1 ? a + (b - a) * dx + (c - a) * dz : d + (c - d) * (1 - dx) + (b - d) * (1 - dz);
}

function riverVertex(stages: ArrayLike<number>, cells: Uint8Array, size: number, i: number, j: number) {
  const stride = size - 1;
  if (i === 0 || j === 0 || i === stride || j === stride) return 0;
  const cell = (x: number, y: number) => cells[y * stride + x];
  if (![cell(i, j), cell(i - 1, j), cell(i, j - 1), cell(i - 1, j - 1)].every(Boolean)) return 0;
  const current = stages[j * size + i];
  if (current > 0) return current;
  // Extend the surface across the bank at nearby channel heights. The terrain clips the surface.
  let sum = 0, weight = 0;
  for (let y = Math.max(0, j - 2); y <= Math.min(size - 1, j + 2); y++) {
    for (let x = Math.max(0, i - 2); x <= Math.min(size - 1, i + 2); x++) {
      const level = stages[y * size + x], distance = (x - i) ** 2 + (y - j) ** 2;
      if (level <= 0 || distance === 0 || distance > 5) continue;
      const influence = 1 / distance ** 2;
      sum += level * influence; weight += influence;
    }
  }
  return weight ? sum / weight : 0;
}

/** Partition the grid into river and sea. One ring of cells lets the river meet the flat tide before the seam. */
export function riverFootprint(stages: ArrayLike<number>, size: number) {
  const stride = size - 1, cells = new Uint8Array(stride * stride);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    if (!(stages[j * size + i] > 0)) continue;
    for (let y = Math.max(0, j - 2); y < Math.min(stride, j + 2); y++) {
      for (let x = Math.max(0, i - 2); x < Math.min(stride, i + 2); x++) {
        const at = y * stride + x;
        const channel = x >= i - 1 && x <= i && y >= j - 1 && y <= j;
        if (channel) cells[at] = CHANNEL;
        else if (!cells[at]) cells[at] = TIDE_MARGIN;
      }
    }
  }
  return cells;
}

/** Cover the river and its margin. The outer vertices sit exactly on the sea surface. */
export function riverGrid(stages: ArrayLike<number>, cells: Uint8Array, size: number, step: number, i0: number, j0: number, i1: number, j1: number) {
  const positions: number[] = [], indices: number[] = [];
  const cols = i1 - i0 + 1, rows = j1 - j0 + 1, half = (size - 1) * step / 2;
  const stride = size - 1;
  const vertices = new Int32Array(cols * rows).fill(-1);
  const vertex = (i: number, j: number) => {
    const at = (j - j0) * cols + i - i0;
    if (vertices[at] < 0) {
      vertices[at] = positions.length / 3;
      positions.push(i * step - half, riverVertex(stages, cells, size, i, j), j * step - half);
    }
    return vertices[at];
  };
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
    if (!cells[j * stride + i]) continue;
    const nw = vertex(i, j), sw = vertex(i, j + 1), ne = vertex(i + 1, j), se = vertex(i + 1, j + 1);
    indices.push(nw, sw, ne, sw, se, ne);
  }
  return { positions, indices };
}

export function renderedRiverAt(stages: ArrayLike<number>, cells: Uint8Array, size: number, step: number, x: number, z: number, tide: number) {
  const stride = size - 1, half = stride * step / 2;
  const gx = (x + half) / step, gz = (z + half) / step, i = Math.floor(gx), j = Math.floor(gz);
  if (i < 0 || j < 0 || i >= stride || j >= stride || !cells[j * stride + i]) return tide;
  const at = (a: number, b: number) => {
    const stage = riverVertex(stages, cells, size, a, b);
    const f = Math.min(1, stage / 1.2);
    return Math.max(tide, stage + tide * (1 - f * f * (3 - 2 * f)));
  };
  return triangleHeight(at(i, j), at(i + 1, j), at(i, j + 1), at(i + 1, j + 1), gx - i, gz - j);
}

/** Combine adjacent sea cells into rectangles, and close the four offshore strips beyond the terrain. */
export function seaGrid(cells: Uint8Array, size: number, step: number, extent: number) {
  const positions: number[] = [], indices: number[] = [];
  const stride = size - 1, half = stride * step / 2;
  const rect = (x0: number, z0: number, x1: number, z1: number) => {
    const a = positions.length / 3;
    positions.push(x0, 0, z0, x0, 0, z1, x1, 0, z0, x1, 0, z1);
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  };
  const withGrid = (i0: number, j0: number, i1: number, j1: number) =>
    rect(i0 * step - half, j0 * step - half, i1 * step - half, j1 * step - half);
  let spans = new Map<number, number>();
  for (let j = 0; j <= stride; j++) {
    const next = new Map<number, number>();
    if (j < stride) for (let i = 0; i < stride;) {
      if (cells[j * stride + i]) { i++; continue; }
      const start = i++;
      while (i < stride && !cells[j * stride + i]) i++;
      const key = start * size + i;
      next.set(key, spans.get(key) ?? j);
      spans.delete(key);
    }
    for (const [key, top] of spans) withGrid(Math.floor(key / size), top, key % size, j);
    spans = next;
  }
  rect(-extent, -extent, extent, -half);
  rect(-extent, half, extent, extent);
  rect(-extent, -half, -half, half);
  rect(half, -half, extent, half);
  return { positions, indices };
}

export function riverStageAt(stages: ArrayLike<number>, size: number, step: number, x: number, z: number) {
  const half = (size - 1) * step / 2;
  if (!(Math.abs(x) < half && Math.abs(z) < half)) return 0;
  const fx = (x + half) / step, fz = (z + half) / step;
  const i = Math.min(size - 2, Math.floor(fx)), j = Math.min(size - 2, Math.floor(fz)), k = j * size + i;
  const tx = fx - i, tz = fz - j, b = stages[k + 1], c = stages[k + size];
  if (tx + tz <= 1) return stageInTriangle(stages[k], b, c, tx, tz);
  return stageInTriangle(stages[k + size + 1], c, b, 1 - tx, 1 - tz);
}

function stageInTriangle(a: number, b: number, c: number, tx: number, tz: number) {
  if (a <= 0 && b <= 0 && c <= 0) return 0;
  const stage = Math.abs(a);
  return stage + (Math.abs(b) - stage) * tx + (Math.abs(c) - stage) * tz;
}
