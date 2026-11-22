/** Where an army that has arrived pitches its camp: a few tents in the open ground round the soldiers' places, and guards on watch between them looking outward. Pure geometry (no scene), so
 *  it can be tested; the same input always gives the same camp, so it does not move about from one frame to the next. */
export interface Pt { x: number; z: number }
export interface Camp { cx: number; cz: number; radius: number; tents: { x: number; z: number; yaw: number }[]; guards: { x: number; z: number; yaw: number }[] }

const TENT_CLEAR = 2.6;   // a tent keeps this far from any soldier's place
const TENT_APART = 4.4;
const GUARD_CLEAR = 3.0;

export function tentsFor(soldiers: number) { return soldiers < 2 ? 0 : Math.min(8, Math.ceil(soldiers / 6)); }
export function guardsFor(soldiers: number) { return soldiers < 3 ? 0 : Math.min(4, Math.max(2, Math.ceil(soldiers / 8))); }

export function campLayout(slots: Pt[], soldiers = slots.length): Camp | null {
  if (!slots.length || soldiers < 2) return null;
  let cx = 0, cz = 0;
  for (const s of slots) { cx += s.x; cz += s.z; }
  cx /= slots.length; cz /= slots.length;
  let radius = 0;
  for (const s of slots) radius = Math.max(radius, Math.hypot(s.x - cx, s.z - cz));
  const free = (x: number, z: number, clear: number) => slots.every(s => Math.hypot(s.x - x, s.z - z) >= clear);
  const tents: Camp['tents'] = [], want = tentsFor(soldiers), steps = 20;
  for (let ring = 0; ring < 8 && tents.length < want; ring++) {
    const r = radius + 3.4 + ring * 2.2;
    for (let i = 0; i < steps && tents.length < want; i++) {
      const a = (i / steps) * Math.PI * 2 + ring * 0.31, x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
      if (free(x, z, TENT_CLEAR) && tents.every(t => Math.hypot(t.x - x, t.z - z) >= TENT_APART)) tents.push({ x, z, yaw: a + Math.PI });   // the door (local +z) faces the soldiers
    }
  }
  const guards: Camp['guards'] = [], wantG = guardsFor(soldiers);
  for (let ring = 0; ring < 4 && guards.length < wantG; ring++) {
    const r = radius + 1.4 + ring * 1.2;
    for (let i = 0; i < 24 && guards.length < wantG; i++) {
      const a = (i / 24) * Math.PI * 2 + 0.17, x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
      if (!free(x, z, GUARD_CLEAR - ring * 0.4) || tents.some(t => Math.hypot(t.x - x, t.z - z) < GUARD_CLEAR + 0.5)) continue;
      if (guards.some(g => Math.hypot(g.x - x, g.z - z) < radius * 0.9 + 3)) continue;   // spread round the camp, not bunched
      guards.push({ x, z, yaw: a });   // looking away from the camp
    }
  }
  return { cx, cz, radius, tents, guards };
}
