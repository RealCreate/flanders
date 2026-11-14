// The time of day. A day is 240 game ticks (the core's DAY), and the village's first morning starts at DAWN_OFFSET of the way round. Everything about light follows from one number,
// the phase of the day: 0 is midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset.
export const DAY_TICKS = 240;
/** Tick 0 is a morning, not midnight: the game opens in daylight. */
export const DAWN_OFFSET = 0.3;

/** The phase of the day (0..1) at a game time in ticks (may be fractional, so the light moves smoothly between ticks). */
export function dayPhase(ticks: number): number { const p = ticks / DAY_TICKS + DAWN_OFFSET; return p - Math.floor(p); }

/** The sun's height above the horizon in degrees: 0 at sunrise and sunset, 52 at noon, negative at night. */
export function sunElevation(phase: number): number { return 52 * Math.sin(2 * Math.PI * (phase - 0.25)); }

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** How dark it is: 0 in full day, 1 at night, easing through dusk and dawn (it is already dim while the sun is still a little above the horizon). */
export function nightFactor(phase: number): number { return 1 - smooth(-9, 7, sunElevation(phase)); }

/** The clock face for a phase: 06:00 at sunrise, 12:00 at noon. */
export function clockText(phase: number): string {
  const minutes = Math.floor(phase * 24 * 60), h = Math.floor(minutes / 60) % 24, m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
