// Where the design options of a road put their things: trees, hedges and flower beds, benches and lanterns along the verges of the stretches the player gave them. Pure geometry on the lines
// of the core (roadmesh.ts' RoadLine), no three.js, so it can be tested under node (tests/roadplan.test.mjs); props.ts turns the plan into models.

import { EDGE, type RoadLine } from './roadmesh.ts';
import { ROAD_OPT } from './roadlook.ts';

export type RoadPropKind = 'tree' | 'hedge' | 'flowers' | 'bench' | 'lantern';
/** One thing standing beside a road. `yaw` turns it the way its model wants: a bench and a lantern face the road, a hedge and a flower bed lie along it. `v` is a stable 0..1 number to vary it by. */
export interface RoadProp { kind: RoadPropKind; x: number; z: number; yaw: number; v: number; line: number }

/** How far apart each kind stands along a road (units) and how far from the middle of the road its middle is. */
export const GAP = { tree: 8.5, hedge: 2.1, flowers: 6.2, bench: 21, lantern: 12.5 } as const;
/** The verge starts here (the soft edge of the ribbon). */
export const VERGE = 1.3 * EDGE;
const SIDE = { tree: VERGE + 2.0, hedge: VERGE + 0.55, flowers: VERGE + 0.55, bench: VERGE + 1.0, lantern: VERGE + 0.6 } as const;
/** Nothing stands this close to where a road starts or ends (the doors of buildings, junctions, the next stretch). */
export const CLEAR_ENDS = 3.6;
/** Nothing stands nearer than this to another road. */
const OTHER_ROAD = VERGE + 0.7;

const hash = (a: number, b: number) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };

/** The points of a line as [x, z, arc length] with the arc length from the start. */
function walk(p: number[]): { x: number; z: number; s: number }[] {
  const out: { x: number; z: number; s: number }[] = []; let s = 0;
  for (let k = 0; k < p.length; k += 2) { if (k) s += Math.hypot(p[k] - p[k - 2], p[k + 1] - p[k - 1]); out.push({ x: p[k], z: p[k + 1], s }); }
  return out;
}

/** The place at arc length d along the walked line, and the unit direction there. */
function at(w: { x: number; z: number; s: number }[], d: number): { x: number; z: number; ux: number; uz: number } {
  let i = 1; while (i < w.length - 1 && w[i].s < d) i++;
  const a = w[i - 1], b = w[i], l = b.s - a.s || 1, f = Math.max(0, Math.min(1, (d - a.s) / l)), ux = (b.x - a.x) / l, uz = (b.z - a.z) / l;
  return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, ux, uz };
}

/** Everything the design options of the lines call for. `lines` are the unjoined lines of the core (a stretch is a line: its design is the same all along). */
export function planRoadProps(lines: RoadLine[], nearGround: (x: number, z: number) => boolean = () => true): RoadProp[] {
  const walked = lines.map(l => walk(l.pts));
  // every line's points in a grid, to keep clear of the other roads
  const CELL = 6, grid = new Map<string, { x: number; z: number; li: number }[]>();
  walked.forEach((w, li) => { for (let k = 0; k < w.length; k++) { const key = Math.floor(w[k].x / CELL) + ':' + Math.floor(w[k].z / CELL); (grid.get(key) ?? grid.set(key, []).get(key)!).push({ x: w[k].x, z: w[k].z, li }); } });
  const nearOther = (x: number, z: number, li: number) => {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const q of grid.get((cx + i) + ':' + (cz + j)) ?? []) if (q.li !== li && Math.hypot(q.x - x, q.z - z) < OTHER_ROAD) return true;
    return false;
  };
  const out: RoadProp[] = [], taken = new Map<string, { x: number; z: number; r: number }[]>();
  const roomFor = (x: number, z: number, r: number) => {   // things keep a little room from each other, whichever stretch they belong to
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const q of taken.get((cx + i) + ':' + (cz + j)) ?? []) if (Math.hypot(q.x - x, q.z - z) < r + q.r) return false;
    (taken.get(cx + ':' + cz) ?? taken.set(cx + ':' + cz, []).get(cx + ':' + cz)!).push({ x, z, r }); return true;
  };
  const RADIUS: Record<RoadPropKind, number> = { tree: 0.9, hedge: 0.55, flowers: 0.9, bench: 1.0, lantern: 0.5 };
  lines.forEach((line, li) => {
    if (line.kind !== 1 || !line.opts) return;
    const w = walked[li], total = w[w.length - 1].s;
    if (total < CLEAR_ENDS * 2 + 2) return;
    const lay = (kind: RoadPropKind, gap: number, phase: number, both: boolean, face: boolean) => {
      for (let d = CLEAR_ENDS + phase, k = 0; d < total - CLEAR_ENDS; d += gap, k++) {
        const p = at(w, d), nx = -p.uz, nz = p.ux;
        for (const side of both ? [1, -1] : [k % 2 ? 1 : -1]) {
          const j = (hash(p.x + side, p.z * 1.3) - 0.5) * (kind === 'hedge' ? 0 : gap * 0.18);   // (trees and lamps are not on a string)
          const px = p.x + nx * SIDE[kind] * side + p.ux * j, pz = p.z + nz * SIDE[kind] * side + p.uz * j;
          if (!nearGround(px, pz) || nearOther(px, pz, li) || !roomFor(px, pz, RADIUS[kind])) continue;
          const yaw = face ? Math.atan2(-side * nx, -side * nz) : kind === 'tree' ? hash(px, pz) * 6.28 : Math.atan2(-p.uz, p.ux);
          out.push({ kind, x: px, z: pz, yaw, v: hash(px * 3.1, pz * 1.7), line: li });
        }
      }
    };
    // the larger things first: the hedge runs on between them
    if (line.opts & ROAD_OPT.trees) lay('tree', GAP.tree, 1.5, true, false);
    if (line.opts & ROAD_OPT.lanterns) lay('lantern', GAP.lantern, 5, false, true);
    if (line.opts & ROAD_OPT.benches) lay('bench', GAP.bench, 9, false, true);
    if (line.opts & ROAD_OPT.hedges) { lay('flowers', GAP.flowers, 1, true, false); lay('hedge', GAP.hedge, 0, true, false); }
  });
  return out;
}
