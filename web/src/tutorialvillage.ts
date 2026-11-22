// The scripted tutorial village. The world named "tutorial" always has the same map and the same start (site 0, ten villagers, the usual stores), and this file is the build order
// that carries it through every step of the guide: where to put each building and when. A test replays it against the real core and checks the guide finishes, so the first
// ten minutes stay reachable and reproducible. Open it with ?world=tutorial. The positions are relative to the town hall.
export const TUTORIAL_WORLD = 'tutorial';

export type Action =
  | { at: number; op: 'place'; kind: number; dx: number; dy: number }
  | { at: number; op: 'train'; kind: number; n: number }
  | { at: number; op: 'upgrade' };

/** Buildings sit at least 20 units from the hall, so the hall has room to grow when it is upgraded. The first raid can come from day 3 (720 ticks), so the defences go up before the second round of houses. */
export const TUTORIAL_SCRIPT: Action[] = [
  { at: 0, op: 'place', kind: 0, dx: -20, dy: -20 },      // house
  { at: 150, op: 'place', kind: 1, dx: -33, dy: -10 },    // farm
  { at: 300, op: 'place', kind: 4, dx: -20, dy: 0 },      // woodcutter
  { at: 450, op: 'place', kind: 5, dx: -20, dy: 8 },      // sawmill
  { at: 600, op: 'place', kind: 6, dx: -2, dy: 26 },      // quarry on the stone deposit
  { at: 750, op: 'place', kind: 16, dx: -20, dy: 16 },    // well
  { at: 900, op: 'place', kind: 3, dx: -16, dy: 20 },     // watchtower
  { at: 1050, op: 'place', kind: 19, dx: -12, dy: -20 },  // barracks
  { at: 1350, op: 'train', kind: 1, n: 6 },               // archers
  { at: 1500, op: 'place', kind: 0, dx: -10, dy: 20 },
  { at: 1650, op: 'place', kind: 1, dx: 0, dy: -31 },
  { at: 1800, op: 'place', kind: 0, dx: 4, dy: 20 },
  { at: 1950, op: 'place', kind: 0, dx: 16, dy: -20 },
  { at: 2100, op: 'place', kind: 0, dx: 10, dy: 20 },
  { at: 2400, op: 'upgrade' },                            // town hall to a manor
];
