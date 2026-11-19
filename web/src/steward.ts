import { DAY_TICKS } from './daycycle.ts';

export type StewardMode = 'pause' | 'steward';
export type StewardAction = StewardMode | 'open' | 'resume' | 'food' | 'wood' | 'work' | 'ruins' | 'market';
export type WatchStop = 'battle' | 'raid' | 'fire' | 'plague' | 'food' | 'wood' | 'decision' | 'shift';
export interface WatchReport { ticks: number; stop?: WatchStop; closed?: boolean }
export const IDLE_MS = 120_000;
export const REVIEW_AFTER_MS = 30_000;
export const STEWARD_SHIFT = DAY_TICKS;

export const WATCH_MESSAGES: Record<WatchStop, string> = {
  battle: 'The village needs orders in an active battle.',
  raid: 'Scouts spotted raiders. Review your defences.',
  fire: 'A fire needs your attention.',
  plague: 'An outbreak needs your attention.',
  food: 'The larder is low. Check your food supply and workers.',
  wood: 'The village needs firewood for winter.',
  decision: 'A visitor or village event needs a decision.',
  shift: 'The steward finished a full day on watch.',
};

type Crisis = Exclude<WatchStop, 'shift'>;
const CRISES: readonly Crisis[] = ['battle', 'raid', 'fire', 'plague', 'food', 'wood', 'decision'];

/** Status flags supplied by World.steward_status in order of urgency. */
export function stewardRisks(flags: number): Crisis[] {
  return CRISES.filter((_, i) => flags & (1 << i));
}

export class VillageWatch {
  mode: StewardMode = 'pause';
  review: WatchReport | null = null;
  private touchedAt = 0;
  private shift: (WatchReport & { since: number; idle: boolean }) | null = null;

  get away() { return this.shift !== null; }
  get working() { return !!this.shift && !this.shift.stop && !this.review && this.mode === 'steward'; }

  observe(now: number, hidden: boolean) {
    if (!this.shift && (hidden || now - this.touchedAt >= IDLE_MS)) {
      this.shift = { since: now, idle: !hidden, ticks: 0 };
    }
  }

  /** A visible human is back. Keep the clock held while they review a long absence or an urgent stop. */
  present(now: number) {
    this.touchedAt = now;
    const shift = this.shift;
    this.shift = null;
    if (shift && (shift.idle || shift.stop || now - shift.since >= REVIEW_AFTER_MS)) {
      this.review = { ticks: (this.review?.ticks ?? 0) + shift.ticks, stop: shift.stop ?? this.review?.stop, closed: this.review?.closed };
    }
  }

  resume(now: number) {
    this.present(now);
    this.review = null;
  }

  openSave(now: number, elapsedMs: number) {
    this.resume(now);
    if (elapsedMs >= REVIEW_AFTER_MS) this.review = { ticks: 0, closed: true };
  }

  pace(requested: number, playerBattle: boolean) {
    if (playerBattle) return 1;
    if (this.review) return 0;
    if (!this.shift) return requested;
    return this.working ? Math.min(requested, 1) : 0;
  }

  /** True when a background shift may take one step. The ordinary clock stays held during review. */
  allowStep(findRisk: () => Crisis | undefined) {
    if (this.review) return false;
    const shift = this.shift;
    if (!shift) return true;
    if (this.mode === 'pause' || shift.stop) return false;
    shift.stop = shift.ticks >= STEWARD_SHIFT ? 'shift' : findRisk();
    return !shift.stop;
  }

  /** Check immediately after each background tick so a returning player sees why the steward stopped. */
  afterStep(findRisk: () => Crisis | undefined) {
    if (!this.shift || this.shift.stop) return;
    this.shift.ticks++;
    this.shift.stop = findRisk() ?? (this.shift.ticks >= STEWARD_SHIFT ? 'shift' : undefined);
  }
}
