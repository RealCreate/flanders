// Run after building the Node WASM with npm run test:demo.
import { createRequire } from 'node:module';
import { DAY_TICKS } from '../src/flowrate.ts';

const { World, catalog, village_sites } = createRequire(import.meta.url)('../tests/.wasm/game_core.js');
const defs = JSON.parse(catalog());
const kind = name => defs.findIndex(def => def.name === name);
const HOUSE = kind('House'), FARM = kind('Farm'), WOODCUTTER = kind('Woodcutter');
const LODGE = kind("Hunter's Lodge"), FISH = kind('Fishing Hut'), BAKERY = kind('Bakery'), PASTURE = kind('Pasture'), PIGSTY = kind('Pigsty');
const WOOD = 0, HUNGER = 6, COLD = 7, HAYSTACKS = 1;
const seeds = [1n, 7n, 42n, 73n, 101n, 337n, 1337n, 2026n, 31337n, 99999n, 424242n, 8675309n];
const food = World.food_table();
const strategies = [
  ['Hall only', []],
  ['One farm', [HOUSE, FARM]],
  ['One farm + extra housing', [HOUSE, FARM, HOUSE]],
  ['Two farms', [HOUSE, FARM, FARM]],
  ['Farm + bakery', [HOUSE, FARM, BAKERY, WOODCUTTER]],
  ['Farm + hunt', [HOUSE, FARM, LODGE]],
  ['Farm + pasture', [HOUSE, FARM, PASTURE]],
  ['Farm + pigsty', [HOUSE, FARM, PIGSTY]],
  ['Farm + fish', [HOUSE, FARM, FISH]],
  ['Two farms + winter prep', [HOUSE, FARM, FARM, WOODCUTTER], true],
];

function nearestSite(seed) {
  const flat = village_sites(seed), sites = [];
  for (let i = 0; i < flat.length; i += 2) sites.push([flat[i], flat[i + 1]]);
  const [x, y] = sites.sort((a, b) => Math.hypot(...a) - Math.hypot(...b))[0];
  return [Math.round(x), Math.round(y)];
}

function place(world, building) {
  // Search outward from the hall, as a player could with the placement preview.
  for (let radius = 8; radius <= Math.ceil(world.build_radius()); radius += 2) {
    const steps = Math.ceil(Math.PI * radius);
    for (let i = 0; i < steps; i++) {
      const angle = i * 2 * Math.PI / steps;
      let x = Math.round(radius * Math.cos(angle)), y = Math.round(radius * Math.sin(angle)), rotation = 0;
      if (building === FISH) {
        const snap = world.fishing_hut_snap(x, y);
        if (!snap.length) continue;
        [x, y, rotation] = snap;
      }
      if (world.can_place(building, x, y) !== 0) continue;
      const result = world.place(building, x, y, rotation);
      if (result >= 0 || result === -6) return result;
    }
  }
  return -1;
}

function meals(stocks) {
  let total = 0;
  for (let i = 0; i < food.length; i += 2) total += stocks[food[i]] * food[i + 1] / 4;
  return total;
}

function run(seed, site, [name, plan, winterPrep], days, legacy) {
  const world = legacy ? World.new_legacy(seed, ...site) : new World(seed, ...site);
  try {
    const missing = [];
    let haystackPending = winterPrep;
    for (const building of plan) {
      const index = place(world, building);
      if (index < 0) missing.push(defs[building].name);
      else if (haystackPending && building === FARM) {
        if (world.set_option(index, HAYSTACKS, true) !== 0) missing.push('Haystacks');
        haystackPending = false;
      }
    }
    const report = { seed: String(seed), site: site.join(', '), strategy: name, missing: missing.join(', '), emptyTicks: 0, raidWarnings: 0 };
    if (missing.length) return report;
    for (let tick = 1; tick <= days * DAY_TICKS; tick++) {
      world.step();
      const stock = world.stocks(), remaining = meals(stock);
      if (remaining < 1) report.emptyTicks++;
      if (world.raid_warning_ticks() === 30) {
        report.firstRaidWarningTick ??= tick;
        report.raidWarnings++;
      }
      if (tick === 30 * DAY_TICKS - 1) {
        report.winterStartMeals = remaining;
        report.winterStartWood = stock[WOOD];
        report.winterStartDailyWood = world.winter_numbers()[2];
      }
    }
    const stock = world.stocks(), vitals = world.vitals();
    return { ...report, pop: world.population(), meals: meals(stock), wood: stock[WOOD], hunger: vitals[HUNGER], cold: vitals[COLD], war: vitals[8], joy: world.happiness() };
  } finally {
    world.free();
  }
}

const year = process.argv.includes('--year');
const legacy = process.argv.includes('--legacy');
const plans = legacy ? strategies.filter(([, plan]) => !plan.includes(PASTURE) && !plan.includes(PIGSTY)) : strategies;
const results = seeds.flatMap(seed => {
  const site = nearestSite(seed);
  return plans.map(strategy => run(seed, site, strategy, year ? 40 : 2, legacy));
});
if (process.argv.includes('--json')) console.log(JSON.stringify(results, null, 2));
else {
  const range = values => `${Math.min(...values)}–${Math.max(...values)}`;
  console.table(plans.map(([strategy]) => {
    const rows = results.filter(row => row.strategy === strategy);
    const complete = rows.filter(row => !row.missing);
    const stat = key => complete.length ? range(complete.map(row => row[key])) : '—';
    const cases = key => complete.length ? complete.filter(row => row[key] > 0).length : '—';
    return {
      strategy, 'built / sites': `${complete.length}/${rows.length}`, 'population': stat('pop'), 'meals left': stat('meals'),
      'empty larder': cases('emptyTicks'), 'hunger deaths': cases('hunger'),
      ...(year ? { 'wood before winter': stat('winterStartWood'), 'daily winter wood': stat('winterStartDailyWood'), 'cold deaths': cases('cold'), 'war deaths': cases('war'), 'raid warnings': stat('raidWarnings') } : {}),
    };
  }));
}
