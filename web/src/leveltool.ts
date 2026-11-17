// The level-ground tool's patch sizes. No imports: tests load it under plain node.
import { LEVEL_RADIUS, LEVEL_HEIGHT } from './net/validate.ts';

/** The sizes the player picks from (the game core accepts every whole radius from LEVEL_RADIUS.min to LEVEL_RADIUS.max). */
export const LEVEL_SIZES = [4, 6, 8, 10, 12, 14];
export const DEFAULT_LEVEL_SIZE = 8;

/** The size after this one (R key): the next larger, wrapping round to the smallest; anything unknown gives the default. */
export function nextLevelSize(r: number): number {
  const i = LEVEL_SIZES.indexOf(r);
  return i < 0 ? DEFAULT_LEVEL_SIZE : LEVEL_SIZES[(i + 1) % LEVEL_SIZES.length];
}
export const levelSizesValid = () => LEVEL_SIZES.every(r => r >= LEVEL_RADIUS.min && r <= LEVEL_RADIUS.max);

/** Target height of the tool: Auto (the land round the patch, sent as -1) or a chosen height, in steps of half a unit. */
export const LEVEL_AUTO = -1;
export const LEVEL_HEIGHT_STEP = 0.5;
export const clampLevelHeight = (h: number): number => !Number.isFinite(h) ? LEVEL_AUTO : Math.min(LEVEL_HEIGHT.max, Math.max(LEVEL_HEIGHT.min, Math.round(h / LEVEL_HEIGHT_STEP) * LEVEL_HEIGHT_STEP));
export const levelHeightLabel = (h: number): string => h < 0 ? 'Auto' : h.toFixed(1);
/** What the patch does to the ground, from the mean height of the ground in it and the height it would be levelled to: filling (earth added), cutting (earth taken away) or nothing much. */
export function levelWork(mean: number, target: number): { kind: 'fill' | 'cut' | 'even'; by: number } {
  const d = target - mean;
  return Math.abs(d) < 0.15 ? { kind: 'even', by: 0 } : d > 0 ? { kind: 'fill', by: d } : { kind: 'cut', by: -d };
}
