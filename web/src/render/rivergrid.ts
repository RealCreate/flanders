/** Water covers both triangles in every terrain cell touching a river-bed vertex. The terrain clips the banks. */
export function riverGrid(mask: ArrayLike<number>, size: number, step: number, level: number, i0: number, j0: number, i1: number, j1: number) {
  const positions: number[] = [], indices: number[] = [];
  const cols = i1 - i0 + 1, rows = j1 - j0 + 1, half = (size - 1) * step / 2;
  const vertices = new Int32Array(cols * rows).fill(-1);
  const vertex = (i: number, j: number) => {
    const at = (j - j0) * cols + i - i0;
    if (vertices[at] < 0) {
      vertices[at] = positions.length / 3;
      positions.push(i * step - half, level, j * step - half);
    }
    return vertices[at];
  };
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
    const k = i + j * size;
    if (!mask[k] && !mask[k + 1] && !mask[k + size] && !mask[k + size + 1]) continue;
    const a = vertex(i, j), b = vertex(i, j + 1), c = vertex(i + 1, j), d = vertex(i + 1, j + 1);
    indices.push(a, b, c, b, d, c);
  }
  return { positions, indices };
}
