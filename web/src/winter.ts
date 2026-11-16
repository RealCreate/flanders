// What winter does in this game, written out for the player from the numbers the core reports (`World.winter_numbers()`): the tooltip on the season in the top bar, the panel it opens and
// the warnings a season ahead. Kept free of the page so it can be tested under plain node (tests/winter.test.mjs). Icons are named here and drawn by the page (no emoji).

/** The core's `winter_numbers()`, named. */
export interface WinterNumbers {
  grain: number; grainHay: number; woodPerDay: number; daysLeftTenths: number; coldDays: number; warm: boolean; grace: number; deathChance: number;
  daysToWinter: number; beds: number; sheds: number; hearthWood: number; unhappy: number; wood: number; winterLeft: number; shedSaves: number;
  heads: number; deathStep: number; deathMax: number; hospitalGrace: number; shedsPerLog: number;
}
export function parseWinter(n: ArrayLike<number>): WinterNumbers {
  return { grain: n[0], grainHay: n[1], woodPerDay: n[2], daysLeftTenths: n[3], coldDays: n[4], warm: n[5] === 1, grace: n[6], deathChance: n[7], daysToWinter: n[8], beds: n[9], sheds: n[10],
    hearthWood: n[11], unhappy: n[12], wood: n[13], winterLeft: n[14], shedSaves: n[15],
    heads: n[16], deathStep: n[17], deathMax: n[18], hospitalGrace: n[19], shedsPerLog: n[20] };
}
const days = (tenths: number) => tenths < 0 ? 'no limit' : `${Math.round(tenths) / 10 >= 10 ? Math.round(tenths / 10) : (Math.round(tenths) / 10).toFixed(1)} days`;
/** Days of firewood left (null when none is burned). */
export const woodDays = (w: WinterNumbers): number | null => w.daysLeftTenths < 0 ? null : w.daysLeftTenths / 10;

/** The one-line tooltip for the season in the top bar. */
export function winterTip(w: WinterNumbers, season: number): string {
  const wood = `Firewood ${w.wood} (${w.woodPerDay}/day in winter, ${days(w.daysLeftTenths)} of it)`;
  if (season === 3) return `Winter, ${w.winterLeft} days left. ${w.warm ? 'The village is warm.' : `COLD for ${w.coldDays} days!`} Farms make ${w.grain}% grain (${w.grainHay}% with haystacks). ${wood}. Click for details.`;
  return `${w.daysToWinter} days until winter. ${wood}. Farms will make ${w.grain}% grain (${w.grainHay}% with haystacks). Click for details.`;
}

/** The warning toast one season ahead (at the start of autumn) and a last call on its final day; null when there is nothing to say. `autumnDay` counts from 1. */
export function winterWarning(w: WinterNumbers, season: number, seasonDay: number): { text: string; tone: string } | null {
  if (season !== 2 || (seasonDay !== 1 && seasonDay !== 10)) return null;
  const left = woodDays(w), short = left !== null && left < 10;
  if (seasonDay === 1) return { text: `Winter comes in ${w.daysToWinter} days. Farms will make only ${w.grain}% grain and the village will burn ${w.woodPerDay} firewood a day: stock up.`, tone: short ? 'bad' : 'info' };
  return { text: left === null ? 'Winter starts tomorrow.' : `Winter starts tomorrow. Firewood for ${days(w.daysLeftTenths)}${short ? ': not enough for the whole winter, cut more wood!' : '.'}`, tone: short ? 'bad' : 'info' };
}

export interface Line { icon: string; title: string; text: string; tone?: 'good' | 'bad' }
/** The rows of the Winter panel: exactly what winter does here, with this village's numbers. */
export function winterLines(w: WinterNumbers, pop: number, season: number): Line[] {
  const left = woodDays(w), enough = left === null || left >= 10;
  const lines: Line[] = [
    { icon: 'farm', title: `Farms make ${w.grain}% of the usual grain`, text: `Spring 100%, summer 125%, autumn 150%. With haystacks beside the field a farm makes ${w.grainHay}% in winter. Fish, game and smoked food are not touched by winter.` },
    { icon: 'wood', title: `Firewood: ${w.woodPerDay} a day for ${pop} villagers`,
      text: `The villagers need wood to stay warm: about one log for each ${w.heads} people every 10 ticks${w.sheds > 0 ? `; your ${w.sheds} woodshed${w.sheds === 1 ? '' : 's'} save${w.shedSaves > 0 ? ` ${w.shedSaves} a day` : ' nothing yet (it takes ${w.shedsPerLog} woodsheds to save one log per burn)'}` : `; each ${w.shedsPerLog} woodsheds on houses save one log per burn`}. Sharing (the winter decision) halves it.` },
    { icon: 'wood', title: left === null ? 'No firewood is burned right now' : `Firewood left: ${days(w.daysLeftTenths)}`, tone: enough ? 'good' : 'bad',
      text: `${w.wood} in store${season === 3 ? ` and ${w.winterLeft} winter days to go` : `, winter is ${w.daysToWinter} days away and lasts 10 days`}. ${enough ? 'That should do.' : 'That will not last the winter: cut more wood or buy firewood when winter begins.'}` },
    { icon: 'cold', title: 'If the village goes cold', tone: w.warm ? undefined : 'bad',
      text: `The town hall's hearth keeps the village warm as long as ${w.hearthWood} log can still be burned: only an empty woodpile makes it cold. A cold village is unhappy at once (up to -12 happiness), and nobody dies for the first ${w.grace} cold days${w.beds > 0 ? ' (the hospital gives you extra days)' : ` (a staffed hospital adds ${w.hospitalGrace} days)`}. After that the cold takes one villager on a day with a chance that grows by ${w.deathStep}% each day, at most ${w.deathMax}%. Fires lit again end it at once.${w.warm ? '' : ` It has been cold for ${w.coldDays} days: ${w.deathChance}% chance today.`}` },
    { icon: 'house', title: 'What helps', text: 'Haystacks beside the farms, woodsheds on the houses, a woodcutter or two, the firewood offer at the start of winter (60 gold for 80 wood), a staffed hospital, a well-stocked larder, and the town hall\'s small supply of wood.' },
  ];
  return lines;
}
