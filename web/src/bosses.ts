// What the screen says about bosses, kept free of the game and three.js so plain node can test it (tests/bosses.test.mjs). The numbers themselves live in the core (`BOSSES` in military.rs).

/** Floats per soldier in `World.battle_units_flat()`: side, kind, x, y, hp, maxhp, alive, swing, facing, elevation, boss, phase, name, aura. */
export const BATTLE_STRIDE = 14;
/** Offsets inside one soldier's record that the boss drawing needs. */
export const B_BOSS = 10, B_PHASE = 11, B_NAME = 12, B_AURA = 13;

export interface BossDef { id: number; name: string; names: string[]; hp: number; dmg: number; speed: number; armor: number; hornReach: number; hornSecs: number; slamReach: number; gold: number; iron: number; desc: string }
/** The boss in a fight, from `World.battle_boss()`: [boss, name, hp, maxhp, phase, alive]. */
export interface BossState { kind: number; name: number; hp: number; max: number; phase: number; alive: boolean }
export function parseBoss(b: ArrayLike<number>): BossState | null {
  if (b.length < 6 || !(b[0] >= 1)) return null;
  return { kind: b[0], name: b[1], hp: Math.max(0, b[2]), max: Math.max(1, b[3]), phase: b[4], alive: b[5] > 0 };
}

/** "Garrick, the Warlord": his own name and what he is. */
export function bossTitle(defs: BossDef[], kind: number, name: number): string {
  const d = defs[kind - 1]; if (!d) return 'A boss';
  return `${d.names[((name % d.names.length) + d.names.length) % d.names.length]}, the ${d.name}`;
}

/** Share of the boss's hit points left (0..1). */
export const hpFraction = (b: BossState): number => Math.max(0, Math.min(1, b.hp / b.max));

/** The line for the boss strip in the battle banner: name, hit points and whether he is enraged or down. */
export function bossLine(defs: BossDef[], b: BossState): string {
  const pct = Math.round(hpFraction(b) * 100);
  return `${bossTitle(defs, b.kind, b.name)} · ${b.alive ? `${pct}%${b.phase > 0 ? ' · enraged' : ''}` : 'fallen'}`;
}

/** What the announcement says when a raid led by a boss begins ("from the north-west" comes from the compass). */
export function raidAnnouncement(defs: BossDef[], b: BossState, dir: string, mine: boolean, who: string): string {
  const t = bossTitle(defs, b.kind, b.name);
  return mine ? `${t}, rides on your village from the ${dir}!` : `${t}, rides on ${who} from the ${dir}.`;
}
export function lairAnnouncement(defs: BossDef[], b: BossState): string { return `Your army enters the lair of ${bossTitle(defs, b.kind, b.name)}.`; }

/** The boss part of a battle report ([seq, won, tag, left, defDead, bldLost, survivors x6, loot x12, boss, name, fell, lair, fledA, fledD]); null for a report with no boss. */
export interface BossReport { kind: number; name: number; fell: boolean; lair: boolean }
export function reportBoss(rep: ArrayLike<number>): BossReport | null {
  const l = rep.length; if (l < 20) return null;
  const kind = rep[l - 6]; if (!(kind >= 1)) return null;
  return { kind, name: rep[l - 5], fell: rep[l - 4] > 0, lair: rep[l - 3] > 0 };
}
/** The sentence for the end of a fight with a boss. */
export function reportLine(defs: BossDef[], r: BossReport, won: boolean): string {
  const t = bossTitle(defs, r.kind, r.name), d = defs[r.kind - 1];
  if (r.fell) return r.lair ? `${t}, is dead and his lair is cleared! ${d ? `+${d.gold} gold, +${d.iron} iron.` : ''}` : `${t}, has fallen! ${d ? `+${d.gold} gold, +${d.iron} iron.` : ''}`;
  return r.lair ? `${t}, held his lair: your army was beaten back.` : won ? `The raiders were beaten back, but ${t}, still lives.` : `${t}, ravaged the village.`;
}
