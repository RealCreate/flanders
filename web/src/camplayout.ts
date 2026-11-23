/** Where an army that has arrived pitches its camp. Pure geometry (no scene), so it can be tested; the same input always gives the same camp.
 *
 *  The camp is a compact yard of its own, laid out in a frame that faces the way the army was marching (`u` forward, `v` to the right): tents grouped in small clusters round a fire, a fence of
 *  spiked logs round the lot with a gate at the front, a watering trough with the horses beside it, guards who patrol inside the fence, and the siege engines parked in rows outside the gate. */
export interface Pt { x: number; z: number }
export interface Spot { x: number; z: number; yaw: number }
export interface Camp {
  cx: number; cz: number; yaw: number;
  /** The middle of the fenced yard and how far it reaches from there (the engines outside the gate not counted): what another camp has to keep clear of. */
  mx: number; mz: number; radius: number;
  tents: Spot[];
  /** A fire in the middle of each cluster of tents; it is lit once `after` tents are up. */
  fires: (Pt & { after: number })[];
  /** The spiked logs of the fence, ordered from the gate outward so that it is built from there; they lean away from the camp (`yaw` points outward). */
  stakes: Spot[];
  /** The two tall posts either side of the gate, and the way the gate faces. */
  gate: Spot[];
  trough: Spot | null;
  /** The commander's big pavilion at the back, and the stores round the camp: kind 0 barrel, 1 crate, 2 rack of spears, 3 hay bale, 4 supply wagon, 5 log bench by a fire, 6 watch tower. */
  commander: Spot | null;
  props: (Spot & { kind: number })[];
  horses: Spot[];
  engines: Spot[];
  /** The path the guards walk, a closed loop just inside the fence, and its length. */
  loop: Pt[]; loopLen: number; guards: number;
}

const CLUSTER = 3;        // tents round one fire
const TENT_RING = 2.3;    // how far a tent stands from its fire
const SU = 8.2, SV = 7.6; // distance between the fires
const BLOB = 4.0;         // a cluster reaches this far from its fire
const MARGIN = 2.2;       // the fence stands this far outside the tents
const YARD = 6.4;         // the depth of the horse yard
const STAKE_GAP = 0.8;
const BACK = 6.5;         // the extra depth behind the tents: the commander's pavilion and the stores
const GATE = 2.4;         // half the width of the gate

export function tentsFor(troops: number) { return troops < 1 ? 0 : Math.min(12, Math.ceil(troops / 5)); }
export function guardsFor(troops: number) { return troops < 3 ? 0 : Math.min(6, Math.max(2, Math.ceil(troops / 8))); }

/** `troops` soldiers and riders, `horses` of them to be shown at the trough (at most 6), `engines` siege engines; the camp is at (cx, cz) and faces `yaw` (direction (sin yaw, cos yaw)). */
export function campLayout(cx: number, cz: number, yaw: number, troops: number, horses = 0, engines = 0): Camp | null {
  if (troops < 1 && engines < 1) return null;
  const sy = Math.sin(yaw), cy = Math.cos(yaw);
  const at = (u: number, v: number): Pt => ({ x: cx + u * sy + v * cy, z: cz + u * cy - v * sy });
  const face = (du: number, dv: number) => yaw + Math.atan2(dv, du);

  const want = tentsFor(troops), clusters = Math.ceil(want / CLUSTER), rows = clusters > 2 ? 2 : 1, cols = Math.max(1, Math.ceil(clusters / rows));
  const tents: Spot[] = [], fires: Camp['fires'] = [];
  for (let k = 0; k < clusters; k++) {
    const fu = ((k % cols) - (cols - 1) / 2) * SU, fv = (Math.floor(k / cols) - (rows - 1) / 2) * SV;
    fires.push({ ...at(fu, fv), after: k * CLUSTER + 1 });
    const a0 = 0.4 + k * 0.9;
    for (let j = 0; j < CLUSTER && tents.length < want; j++) {
      const a = a0 + (j * Math.PI * 2) / CLUSTER, p = at(fu + Math.cos(a) * TENT_RING, fv + Math.sin(a) * TENT_RING);
      tents.push({ ...p, yaw: face(-Math.cos(a), -Math.sin(a)) });   // the door (local +z) faces the fire
    }
  }

  const hx = want ? (cols - 1) * SU / 2 + BLOB : 3, hz = want ? (rows - 1) * SV / 2 + BLOB : 3;
  const yard = horses > 0 ? YARD : 0;
  const A = Math.max(hx + MARGIN, yard ? 6.4 : 4), vmin = -hz - MARGIN, vmax = hz + MARGIN + yard, vc = (vmin + vmax) / 2, B = A + (want ? BACK : 0);

  // the fence: the four sides in turn, starting with the front (where the gate is), keeping the logs that are not in the gate
  const corners: [number, number][] = [[A, vmin], [A, vmax], [-B, vmax], [-B, vmin]], normals: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const perimeter = 2 * (A + B) + 2 * (vmax - vmin);
  const logs: { s: number; spot: Spot }[] = [];
  let s0 = 0;
  corners.forEach(([u0, v0], i) => {
    const [u1, v1] = corners[(i + 1) % 4], len = Math.hypot(u1 - u0, v1 - v0), n = Math.max(1, Math.round(len / STAKE_GAP));
    for (let j = 0; j < n; j++) {
      const k = j / n, u = u0 + (u1 - u0) * k, v = v0 + (v1 - v0) * k;
      if (i === 0 && Math.abs(v - vc) < GATE) continue;
      logs.push({ s: s0 + k * len, spot: { ...at(u, v), yaw: face(normals[i][0], normals[i][1]) } });
    }
    s0 += len;
  });
  const gateS = vc - vmin, far = (s: number) => { const d = Math.abs(s - gateS); return Math.min(d, perimeter - d); };
  const stakes = want ? logs.sort((a, b) => far(a.s) - far(b.s)).map(l => l.spot) : [];

  let trough: Spot | null = null;
  const horseSpots: Spot[] = [];
  if (yard && want) {
    const tv = hz + MARGIN + yard / 2;
    trough = { ...at(0, tv), yaw };
    for (let j = 0; j < Math.min(6, horses); j++) {
      const side = j % 2 ? 1 : -1;
      horseSpots.push({ ...at((Math.floor(j / 2) - 1) * 1.9, tv + side * 1.5), yaw: face(0, -side) });   // standing along the trough, heads to the water
    }
  }

  const engineSpots: Spot[] = [];
  for (let i = 0; i < engines; i++) {
    const row = Math.floor(i / 4), inRow = Math.min(4, engines - row * 4), col = i % 4;
    engineSpots.push({ ...at(A + 4.6 + row * 5.2, vc + (col - (inRow - 1) / 2) * 3.8), yaw });   // rows outside the gate, all facing out
  }

  const inset = 1.2, loopPts = want ? [at(A - inset, vmin + inset), at(A - inset, vmax - inset), at(-B + inset, vmax - inset), at(-B + inset, vmin + inset)] : [];
  const loopLen = want ? 2 * (A + B - 2 * inset) + 2 * (vmax - vmin - 2 * inset) : 0;
  const gate = want ? [-1, 1].map(side => ({ ...at(A, vc + side * (GATE + 0.3)), yaw })) : [];
  const u0 = -(hx + 4.2), props: Camp['props'] = [];
  let commander: Spot | null = null;
  if (want) {
    commander = { ...at(u0, 0), yaw: face(1, 0) };
    for (const [du, v, kind, turn] of [[0.3, -3.9, 0, 0], [-0.7, -4.6, 0, 1], [0.8, -4.7, 0, 2], [0.2, 3.9, 1, 0.3], [-0.5, 4.7, 1, 0.9], [0.9, 4.5, 1, 0.1]]) props.push({ ...at(u0 + du, v), yaw: yaw + turn, kind });
    props.push({ ...at(A - 2.6, vc + GATE + 1.6), yaw: face(1, 0), kind: 2 });   // spears in a rack by the gate
    fires.forEach((f, k) => { for (const a of [0.4 + k * 0.9 + Math.PI / 3, 0.4 + k * 0.9 + Math.PI * 4 / 3]) props.push({ x: f.x + Math.cos(a) * 0 + (at(Math.cos(a) * 1.2, Math.sin(a) * 1.2).x - cx), z: f.z + (at(Math.cos(a) * 1.2, Math.sin(a) * 1.2).z - cz), yaw: face(Math.cos(a), Math.sin(a)), kind: 5 }); });   // logs to sit on round each fire
    if (trough) for (const side of [-1, 1]) props.push({ ...at(side * 4.5, hz + MARGIN + yard / 2), yaw: yaw + side, kind: 3 });   // hay for the horses
    props.push({ ...at(-B - 3.6, vc - 2.5), yaw: face(1, 0.3), kind: 4 });   // the supply wagon, parked behind the fence
    for (const v of [vmin, vmax]) props.push({ ...at(A + 0.6, v), yaw, kind: 6 });   // a watch tower at each front corner
  }
  const mid = at((A - B) / 2, vc), radius = want ? Math.hypot((A + B) / 2, (vmax - vmin) / 2) + 3 : 6;
  return { cx, cz, yaw, mx: mid.x, mz: mid.z, radius, tents, fires, stakes, gate, trough, commander, props, horses: horseSpots, engines: engineSpots, loop: loopPts, loopLen, guards: want ? guardsFor(troops) : 0 };
}

/** Where a guard is `s` metres along the patrol loop, and which way he is walking. */
export function patrolAt(c: Camp, s: number): Spot {
  const n = c.loop.length;
  if (!n) return { x: c.cx, z: c.cz, yaw: c.yaw };
  let d = ((s % c.loopLen) + c.loopLen) % c.loopLen;
  for (let i = 0; i < n; i++) {
    const a = c.loop[i], b = c.loop[(i + 1) % n], len = Math.hypot(b.x - a.x, b.z - a.z);
    if (d <= len || i === n - 1) { const k = len ? Math.min(1, d / len) : 0; return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, yaw: Math.atan2(b.x - a.x, b.z - a.z) }; }
    d -= len;
  }
  return { x: c.cx, z: c.cz, yaw: c.yaw };
}
