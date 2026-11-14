// Replaying a village's history. A village is nothing but its signed command log played onto the empty map, so the same log can be played again, paused, rewound
// and fast-forwarded: that is replay (your own history) and spectating (another player's, as we hold it). Nothing here touches the network or the live game.
import type { World } from './wasm/game_core.js';

export interface ReplayCmd { tick: number }

export interface ReplaySource<C extends ReplayCmd> {
  /** A fresh village on the empty map, at tick 0. */
  make(): World;
  /** Apply one command the way the live game did. */
  apply(w: World, c: C): void;
  /** The history, in order. */
  cmds: C[];
}

export class Replay<C extends ReplayCmd> {
  world: World;
  /** Index of the next command to apply. */
  private idx = 0;
  /** The tick the history ends at: the last command (the live game may have run on past it). */
  end: number;
  /** Called when the world object is replaced (after a rewind), so the caller can show the new one. */
  onWorld: (w: World) => void = () => {};

  private src: ReplaySource<C>;

  constructor(src: ReplaySource<C>, endTick?: number) {
    this.src = src;
    this.world = src.make();
    const last = src.cmds.length ? src.cmds[src.cmds.length - 1].tick : 0;
    this.end = Math.max(endTick ?? 0, last);
  }

  get tick() { return Number(this.world.tick()); }

  private reset() { this.world = this.src.make(); this.idx = 0; this.onWorld(this.world); }

  /**
   * Run towards `target` for at most `budgetMs` of real time. Going backwards starts again from the beginning. Returns what happened, so the caller knows
   * what to redraw: `applied` when commands changed the village, `rewound` when the world was replaced.
   */
  advanceTo(target: number, budgetMs = Infinity, now: () => number = () => performance.now()): { reached: boolean; applied: boolean; rewound: boolean } {
    const goal = Math.max(0, Math.min(Math.floor(target), this.end));
    let rewound = false, applied = false;
    if (goal < this.tick) { this.reset(); rewound = true; }
    const t0 = now(), cmds = this.src.cmds;
    let n = 0;
    while (this.tick < goal || (this.idx < cmds.length && cmds[this.idx].tick <= goal && cmds[this.idx].tick <= this.tick)) {
      const c = cmds[this.idx];
      if (c && c.tick <= this.tick) { this.src.apply(this.world, c); this.idx++; applied = true; }
      else if (this.tick < goal) this.world.step();
      else break;
      if ((++n & 63) === 0 && now() - t0 > budgetMs) break;
    }
    return { reached: this.tick >= goal, applied, rewound };
  }
}
