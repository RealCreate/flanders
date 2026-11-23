import type { Terrain } from './render/terrain';
import type { Forest } from './render/trees';
import type { World } from './wasm/game_core.js';
import { footprint_of } from './wasm/game_core.js';

/** What a camp has to keep off: water, steep ground, rocks and ore, buildings and standing trees. `begin()` reads the village's buildings and deposits once for a whole search of places. */
export interface CampSite { begin(): void; blocked(x: number, z: number, r: number): boolean }

const NOT_SOLID = new Set([32, 33, 34, 37]);   // river, raised and lowered ground, roads: an army may camp on them (water is looked at on its own)

export function campSite(world: () => World, terrain: Terrain, forest: () => Forest | undefined): CampSite {
  let discs: { x: number; z: number; r: number }[] = [];
  return {
    begin() {
      const w = world(), b = w.buildings_flat(), d = w.deposits_flat();
      discs = [];
      for (let o = 0; o + 9 < b.length; o += 10) if (!NOT_SOLID.has(b[o])) discs.push({ x: b[o + 2], z: b[o + 3], r: footprint_of(b[o], b[o + 1]) });
      for (let i = 0; i + 4 < d.length; i += 5) if (d[i + 4] > 0) discs.push({ x: d[i + 1], z: d[i + 2], r: 4 });
    },
    blocked(x, z, r) {
      for (const q of discs) if (Math.hypot(q.x - x, q.z - z) < q.r + r) return true;
      const h = terrain.heightAt(x, z);
      let lo = h, hi = h;
      for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
        const px = x + dx, pz = z + dz;
        if (terrain.wetAt(px, pz)) return true;
        const y = terrain.heightAt(px, pz); if (y < lo) lo = y; if (y > hi) hi = y;
      }
      if (terrain.wetAt(x, z) || hi - lo > 0.5 + 0.45 * r) return true;
      return (forest()?.countTrees(x, z, r) ?? 0) > 0;
    },
  };
}
