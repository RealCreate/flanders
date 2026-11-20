const GIVEN = [
  'Adele', 'Boudewijn', 'Clara', 'Diederik', 'Elisabeth', 'Filip', 'Godelieve', 'Hendrik',
  'Ida', 'Jan', 'Kathelijne', 'Lieven', 'Margriet', 'Niklaas', 'Odile', 'Pieter',
  'Sibille', 'Robrecht', 'Trude', 'Willem', 'Beatrijs', 'Gillis', 'Lijsbeth', 'Wouter', 'Logg', 'Real', 'Realerend', 'Realicus'
];
const FAMILY = [
  'Van den Berg', 'Van den Bos', 'Van Damme', 'De Clercq', 'De Smet', 'Van de Velde', 'De Vos', 'Van den Broeck',
  'Van Dijk', 'De Vries', 'De Ridder', 'Van der Molen', 'Van Aelst', 'Van Loo', 'De Bruyn', 'Maes', 'Van Der Tree', 'De Brosk', 'Creatore', 'Creatius Maximus'
];

const WOODCUTTER = 4, BUILDERS_YARD = 20, MARKET = 28;
const jobNames: Record<number, string> = { [WOODCUTTER]: 'Woodcutter', [BUILDERS_YARD]: 'Builder', [MARKET]: 'Market attendant' };
const named: { name: string; jobs?: readonly number[] }[] = [
  { name: 'REALICUS CREATIUS MAXIMUS', jobs: [BUILDERS_YARD] },
  { name: 'Logg VanDerTree', jobs: [WOODCUTTER] },
  { name: 'Dtree', jobs: [WOODCUTTER] },
  { name: 'RealCreate', jobs: [BUILDERS_YARD] },
  { name: 'RealCBro', jobs: [BUILDERS_YARD] },
  { name: 'RealCBroTwo', jobs: [BUILDERS_YARD, MARKET] },
];
export const NAMED_VILLAGERS = named.filter((person, i) =>
  named.findIndex(entry => entry.name.toLowerCase() === person.name.toLowerCase()) === i);

/** Represent the jobs staffed by the village. Named specialists take compatible slots first. */
export function villagerWorkplaces(staffed: number[], kinds: number[], count: number): number[] {
  const slots = staffed.slice(), work = new Array<number | undefined>(count).fill(undefined);
  for (let i = 0; i < Math.min(count, NAMED_VILLAGERS.length); i++) {
    const jobs = NAMED_VILLAGERS[i].jobs;
    if (!jobs) continue;
    work[i] = 0;
    for (const job of jobs) {
      const slot = slots.findIndex(b => kinds[b] === job);
      if (slot < 0) continue;
      work[i] = slots.splice(slot, 1)[0];
      break;
    }
  }
  let slot = 0;
  return work.map(building => building ?? slots[slot++] ?? 0);
}

export function villagerProfession(id: number, workplaceKind: number) {
  const jobs = NAMED_VILLAGERS[id]?.jobs;
  return jobs?.includes(workplaceKind) ? workplaceKind : jobs?.[0];
}

export function villagerJob(id: number, workplaceKind: number): string | undefined {
  const profession = villagerProfession(id, workplaceKind);
  return profession === undefined ? undefined : jobNames[profession];
}

function ordinal(n: number) {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

export function villagerName(id: number, villageX: number, villageZ: number): string {
  const person = NAMED_VILLAGERS[id];
  if (person) return person.name;
  const salt = (Math.imul(Math.round(villageX), 37) ^ Math.imul(Math.round(villageZ), 73)) >>> 0;
  const index = id - NAMED_VILLAGERS.length, combinations = GIVEN.length * FAMILY.length;
  const slot = index % GIVEN.length;
  const given = GIVEN[(slot + salt) % GIVEN.length];
  const family = FAMILY[(Math.floor(index / GIVEN.length) + slot * 3 + (salt >>> 6)) % FAMILY.length];
  const name = `${given} ${family}`;
  const reserved = NAMED_VILLAGERS.some(person => person.name.toLowerCase() === name.toLowerCase());
  const generation = Math.floor(index / combinations) + (reserved ? 2 : 1);
  return generation === 1 ? name : `${name} the ${ordinal(generation)}`;
}

export interface VillagerEntry { id: number; name: string; workplace: number; kind: number; job?: string; }
