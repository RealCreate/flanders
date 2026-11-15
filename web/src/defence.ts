// The rules of the battle banner and of sending troops to a fight, kept free of the game and the screen so they can be tested under plain node (tests/defence.test.mjs).

/** Which side the player is on in a battle: defending their own village, attacking somebody's, or only watching. */
export type Role = 'defend' | 'attack' | 'watch';
export function roleOf(inOwnVillage: boolean, attackerTag: number, myTag: number): Role {
  if (inOwnVillage) return 'defend';
  return attackerTag === myTag ? 'attack' : 'watch';
}

/** What the player can do about the fight. Both sides get the same kinds of options: the defender sends troops out, the attacker calls his off or sends more. */
export type Action = 'look' | 'send-armies' | 'sally' | 'retreat' | 'reinforce';
export function actionsFor(role: Role, o: { armies: number; standing: number; reserve: number }): Action[] {
  const out: Action[] = ['look'];
  if (role === 'defend') { if (o.armies > 0) out.push('send-armies'); if (o.standing > 0) out.push('sally'); }
  if (role === 'attack') { out.push('retreat'); if (o.reserve > 0) out.push('reinforce'); }
  return out;
}

/** Where the camera goes to see the attackers: out from the village centre along the direction they came from, just outside the village. */
export function foeFocus(angle: number, ox: number, oz: number, buildRadius: number): { x: number; z: number } {
  const r = buildRadius + 22;
  return { x: ox + Math.cos(angle) * r, z: oz + Math.sin(angle) * r };
}

/** A raid has just begun in the village on screen (and the player wants to be taken there): true on the frame the fight starts, never again while it lasts. */
export function shouldAutoJump(wasActive: boolean, isActive: boolean, enabled: boolean, role: Role): boolean {
  return enabled && isActive && !wasActive && role === 'defend';
}

/** The nearest living attacker to (x, z) in `battle_units_flat` (stride 14: side, kind, x, y, hp, maxhp, alive, ..., boss, phase, name, aura), if one is within `reach`. */
export function foeNear(flat: ArrayLike<number>, x: number, z: number, reach: number, stride = 14): { x: number; z: number; d: number } | null {
  let best: { x: number; z: number; d: number } | null = null;
  for (let i = 0; i + 9 < flat.length; i += stride) {
    if (flat[i] !== 1 || flat[i + 6] <= 0) continue;
    const d = Math.hypot(flat[i + 2] - x, flat[i + 3] - z);
    if (d <= reach && (!best || d < best.d)) best = { x: flat[i + 2], z: flat[i + 3], d };
  }
  return best;
}

/** How many of each kind a sally takes: everybody standing (there is one entry per soldier kind: spearmen, archers, swordsmen, knights, catapults). */
export function sallyUnits(standing: ArrayLike<number>): number[] { return [0, 1, 2, 3, 4].map(k => Math.max(0, Math.floor(standing[k] ?? 0))); }

/** The drawbridge states in `buildings_flat` (stride 10, status at +6): 5 drawn up by hand, 6 and 7 lowered for an army (see lend.rs in the core). */
export const DB_UP = 5, DB_LENT = 6, DB_LENT_FIGHT = 7;
export const isLent = (status: number) => status === DB_LENT || status === DB_LENT_FIGHT;
/** Is this drawbridge drawn up as it is drawn on the screen? Raised by hand, or raised for the fight (every drawbridge is while raiders attack) unless it is lent to an army. */
export const drawnUp = (status: number, fighting: boolean) => status === DB_UP || (fighting && !isLent(status));

/** The drawbridges (building indexes) that have just been lowered for an army: lent now, and not in `before`. Returns them with the new set to remember. */
export function newlyLent(flat: ArrayLike<number>, before: ReadonlySet<number>): { fresh: number[]; now: Set<number> } {
  const now = new Set<number>(), fresh: number[] = [];
  for (let i = 0; i + 9 < flat.length; i += 10) if (flat[i] === 23 && isLent(flat[i + 6])) { now.add(i / 10); if (!before.has(i / 10)) fresh.push(i / 10); }
  return { fresh, now };
}
