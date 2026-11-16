// The level-ground tool's patch sizes. No imports: tests load it under plain node.
import { LEVEL_RADIUS } from './net/validate.ts';

/** The sizes the player picks from (the game core accepts every whole radius from LEVEL_RADIUS.min to LEVEL_RADIUS.max). */
export const LEVEL_SIZES = [4, 6, 8, 10, 12, 14];
export const DEFAULT_LEVEL_SIZE = 8;

/** The size after this one (R key): the next larger, wrapping round to the smallest; anything unknown gives the default. */
export function nextLevelSize(r: number): number {
  const i = LEVEL_SIZES.indexOf(r);
  return i < 0 ? DEFAULT_LEVEL_SIZE : LEVEL_SIZES[(i + 1) % LEVEL_SIZES.length];
}
export const levelSizesValid = () => LEVEL_SIZES.every(r => r >= LEVEL_RADIUS.min && r <= LEVEL_RADIUS.max);
