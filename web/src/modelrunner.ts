// Builds the planned model village in your own village through signed commands (a testing tool; see modelvillage.ts for the plan).
import type { World } from './wasm/game_core.js';
import { defs } from './data';
import { buildModelVillage, type ModelApi } from './modelvillage';
import type { Cmd } from './net/p2p';

/** The level of ground the whole site is flattened to: the city, its moat and the farmland and workshops outside it. */
export const MODEL_FLAT_RADIUS = 108;

export interface ModelCtx {
  world: World;
  commit(cmd: Omit<Cmd, 'tick' | 'n'>): void;
  /** Redraw after the ground or buildings changed. */
  changed(): void;
}

/** Clear every building except the town hall and build the model village. Returns false if it cannot be done now. */
export function runModelVillageIn(ctx: ModelCtx): boolean {
  const w = ctx.world, commit = ctx.commit;
  if (w.battle_active()) return false;
  if (w.cheat(8, 0, 0)) commit({ op: 'cheat', kind: 8, x: 0, y: 0 });   // clear old earthworks, craters, scorch and ruins first
  w.cheat(7, 0, 0) && commit({ op: 'cheat', kind: 7, x: 0, y: 0 });
  for (let i = w.building_count() - 1; i >= 1; i--) if (w.demolish(i)) commit({ op: 'demolish', idx: i });
  // level the whole site first: the castle is only raised once the ground under it is flat
  if (w.flatten(MODEL_FLAT_RADIUS) === 0) commit({ op: 'flatten', x: MODEL_FLAT_RADIUS });
  ctx.changed();
  const fill = () => { if (w.cheat(3, 0, 0)) commit({ op: 'cheat', kind: 3, x: 0, y: 0 }); };
  const api: ModelApi = {
    place(kind, x, y, rot = 0, search = 8, ok) {
      for (let r = 0; r <= search; r += 1.5) for (let k = 0; k < (r ? 8 : 1); k++) {
        const a = k * Math.PI / 4 + r, px = Math.round(x + Math.cos(a) * r), py = Math.round(y + Math.sin(a) * r);
        if (ok && !ok(px, py)) continue;
        const st = Array.from(w.stocks()); if (defs[kind].cost.some(([res, n]) => st[res] < n)) fill();
        const i = w.place(kind, px, py, rot); if (i >= 0) { commit({ op: 'place', kind, x: px, y: py, rot }); return i; }
      }
      return -1;
    },
    upgrade(i) { let c = w.upgrade(i); if (c === -6) { fill(); c = w.upgrade(i); } if (c === 0) { commit({ op: 'upgrade', idx: i }); return true; } return false; },
    option(i, bit) { let c = w.set_option(i, bit, true); if (c === -6) { fill(); c = w.set_option(i, bit, true); } if (c === 0) { commit({ op: 'option', idx: i, kind: bit, x: 1 }); return true; } return false; },
    garrison(i, n) { if (w.garrison_set(i, n) === 0) commit({ op: 'garrison', idx: i, kind: n }); },
    wet(x, y) { return w.height_at(w.origin_x() + x, w.origin_y() + y) < 0; },
    at(i) { const f = w.buildings_flat(); return [f[i * 10 + 2] - w.origin_x(), f[i * 10 + 3] - w.origin_y()]; },
    fill,
    clearLand(r) { w.demo(0, r, 0, 0); commit({ op: 'demo', kind: 0, x: r, y: 0, idx: 0 }); },
    deposit(kind, x, y) { const i = w.demo(1, kind, x, y); if (i >= 0) commit({ op: 'demo', kind: 1, x: kind, y: x, idx: y }); return i; },
    grove(x, y, r) { if (w.demo(2, x, y, r) === 0) commit({ op: 'demo', kind: 2, x, y, idx: r }); },
    forestSpot(minR, maxR, from, to) { const v = w.forest_spot(minR, maxR, from, to); return v.length ? [v[0], v[1], v[2]] : null; },
    soldiers(kind, n) { if (w.cheat(2, kind, n)) commit({ op: 'cheat', kind: 2, x: kind, y: n }); },
  };
  buildModelVillage(api);
  ctx.changed();
  return true;
}
