// Which wall pieces join up: a pure function (no three.js) so the model village test can check that every wall is really connected.
export const REACH = 8.6;                 // wall pieces closer than this join up
export const FENCE_REACH = 5.6;           // spiked-log pieces join up at a shorter distance
export const GATE_HALF = 3.6;             // a gate's two pillars stand this far from its centre: a doorway about 4.5 wide between the pillars, room for soldiers marching two abreast
const FENCE = 21;
export interface LinkNode { x: number; z: number; kind: number }

export function linkWalls(nodes: LinkNode[]) {
    // Candidate links, shortest first. Walls and gates link with each other, fences with fences. A link is skipped when it would
    // close a triangle (both ends already share a neighbour) or run past a piece that sits on the way (that piece links up instead).
    const group = (n: LinkNode) => (n.kind === FENCE ? 1 : 0), reach = (n: LinkNode) => (n.kind === FENCE ? FENCE_REACH : REACH);
    const cand = new Map<string, { i: number; j: number; d: number }>(), degree = new Array(nodes.length).fill(0), adj: Set<number>[] = nodes.map(() => new Set<number>());
    nodes.forEach((a, i) => {
      const near = nodes.map((b, j) => ({ j, d: Math.hypot(a.x - b.x, a.z - b.z) })).filter(o => o.j !== i && group(nodes[o.j]) === group(a) && o.d <= reach(a)).sort((p, q) => p.d - q.d).slice(0, 2);
      for (const o of near) { const lo = Math.min(i, o.j), hi = Math.max(i, o.j); cand.set(`${lo}-${hi}`, { i: lo, j: hi, d: o.d }); }
    });
    const edges: [number, number][] = [];
    for (const c of [...cand.values()].sort((p, q) => p.d - q.d)) {
      const A = nodes[c.i], B = nodes[c.j], dx = B.x - A.x, dz = B.z - A.z, l2 = dx * dx + dz * dz || 1;
      let ok = true;
      for (const n of adj[c.i]) if (adj[c.j].has(n)) { ok = false; break; }
      if (ok) nodes.forEach((P, k) => { if (!ok || k === c.i || k === c.j || group(P) !== group(A)) return; const t = ((P.x - A.x) * dx + (P.z - A.z) * dz) / l2; if (t > 0.08 && t < 0.92 && Math.hypot(P.x - (A.x + dx * t), P.z - (A.z + dz * t)) < 1.3) ok = false; });
      if (!ok) continue;
      edges.push([c.i, c.j]); adj[c.i].add(c.j); adj[c.j].add(c.i); degree[c.i]++; degree[c.j]++;
    }

  return { edges, adj, degree };
}
