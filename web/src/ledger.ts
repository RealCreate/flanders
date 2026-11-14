// Cross-checking battle loot. When one village attacks another, the battle is played out in the DEFENDER's village, and every player holds a copy of that village,
// so every player computes the same result. The attacker then reports its survivors and loot in a signed "return" command. If the attacker lies, the copies of
// its village that other players hold would carry loot nobody earned. The ledger remembers the real results as the copies of the defenders report them, and a
// "return" is replaced by the real result when one is known.
//
// What it cannot do: if no copy of the defender was watching (you joined late, or the defender's history had not arrived), there is nothing to check against,
// and the claim stands (the core still limits it to what was sent away and to a raider's share of a full store).

export interface BattleResult { units: number[]; loot: number[] }

export class Ledger {
  private byTag = new Map<number, BattleResult[]>();
  /** A battle result seen in some village: `tag` is the attacker, `units` the survivors, `loot` what they took. */
  record(tag: number, units: number[], loot: number[]) {
    if (!tag) return;   // bandits (tag 0) have no village to pay
    const l = this.byTag.get(tag) ?? []; l.push({ units: units.slice(0, 5), loot: loot.slice() });
    if (l.length > 32) l.shift();
    this.byTag.set(tag, l);
  }
  /** The attacker `tag` claims these survivors and loot. Returns what to apply and whether it was checked (a checked result is used once; older unclaimed results are dropped). */
  claim(tag: number, units: number[] | undefined, loot: number[] | undefined): { units: number[]; loot: number[]; checked: boolean; lied: boolean } {
    const l = this.byTag.get(tag), real = l?.pop();   // the latest result: older ones belong to returns that never came
    if (l) l.length = 0;
    if (!real) return { units: units ?? [], loot: loot ?? [], checked: false, lied: false };
    const same = (a: number[] | undefined, b: number[]) => !!a && a.length === b.length && a.every((v, i) => v === b[i]);
    return { units: real.units, loot: real.loot, checked: true, lied: !(same(units, real.units) && same(loot, real.loot)) };
  }
  /** Results recorded and not yet claimed, for tests and the sync indicator. */
  pending(tag: number) { return this.byTag.get(tag)?.length ?? 0; }
}
