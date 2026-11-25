// When may the game draw less often? A paused village that nobody is touching shows the same picture frame after frame (the water, the trees' sway, the people and
// the fires all run on the game clock, which is stopped), so drawing it at full rate only heats the device. No imports: tests load it under plain node.

/** Longest pause between frames of a still scene, and how long after the last touch, key or mouse move the scene counts as still. */
export const IDLE_FRAME_MS = 100, IDLE_AFTER_MS = 1500;

export interface SceneFacts {
  /** The village clock is stopped (paused, or the steward's review is open). */
  paused: boolean;
  /** Milliseconds since the last pointer, touch, key or wheel event. */
  msSinceInput: number;
  /** Something moves the picture on its own: a replay, the showroom, the camera following a villager or the attackers, the profiler. */
  animating: boolean;
}

export const sceneIsStill = (f: SceneFacts): boolean => f.paused && !f.animating && f.msSinceInput > IDLE_AFTER_MS;

/** Whether this frame should be skipped: only a still scene skips, and only until its (slow) turn comes. */
export const skipFrame = (still: boolean, msSinceLast: number): boolean => still && msSinceLast < IDLE_FRAME_MS - 2;
