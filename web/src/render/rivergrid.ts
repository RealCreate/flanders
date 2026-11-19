/** Positive samples mark the footprint. Their neighbouring bank vertices keep the same stage instead of dropping to sea level. */
export function riverGrid(stages: ArrayLike<number>, size: number, step: number, i0: number, j0: number, i1: number, j1: number) {
  const positions: number[] = [], indices: number[] = [], banks: number[] = [];
  const cols = i1 - i0 + 1, rows = j1 - j0 + 1, half = (size - 1) * step / 2;
  const vertices = new Int32Array(cols * rows).fill(-1);
  const vertex = (i: number, j: number) => {
    const at = (j - j0) * cols + i - i0;
    if (vertices[at] < 0) {
      vertices[at] = positions.length / 3;
      const stage = stages[j * size + i];
      positions.push(i * step - half, Math.abs(stage), j * step - half);
      banks.push(stage <= 0 ? 1 : 0);
    }
    return vertices[at];
  };
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
    const k = i + j * size;
    const a = stages[k], b = stages[k + size], c = stages[k + 1], d = stages[k + size + 1];
    if (a > 0 || b > 0 || c > 0) indices.push(vertex(i, j), vertex(i, j + 1), vertex(i + 1, j));
    if (b > 0 || c > 0 || d > 0) indices.push(vertex(i, j + 1), vertex(i + 1, j + 1), vertex(i + 1, j));
  }
  return { positions, indices, banks };
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
