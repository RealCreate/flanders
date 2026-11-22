// World names. A world name is both the map (it seeds the terrain) and the room players meet in, so two friends only see each other if their names come out identical. Names are
// therefore normalised the same way everywhere: a link, the start screen and the invite button all go through `cleanWorld`.
export const DEFAULT_WORLD = 'flanders';

/** Lower case, no markup or control characters, single spaces, at most 40 characters; the default world when nothing usable is left. */
export function cleanWorld(raw: unknown): string {
  const s = String(raw ?? '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 40).trim();
  return s || DEFAULT_WORLD;
}

/** The address of this page with the world in it, keeping whatever else is in the address. */
export function withWorld(href: string, world: string): string {
  const u = new URL(href); u.searchParams.set('world', cleanWorld(world)); return u.toString();
}

/** The link to give a friend: this page, this world, and nothing personal (no player slot, no agent token). */
export function inviteLink(href: string, world: string): string {
  const u = new URL(href); const w = cleanWorld(world); u.search = ''; u.hash = ''; u.searchParams.set('world', w); return u.toString();
}

/** Bumped when the map generator changes, so old world names get new maps. */
export const SEED_SALT = 3;
/** The map seed of a world name (a plain number is used as the seed itself). */
export const hashSeed = (s: string): bigint => { if (/^\d{1,15}$/.test(s)) return BigInt(s) + BigInt(SEED_SALT) * 1000003n; let h = 1469598103934665603n; for (const c of (s.toLowerCase() + '|map' + SEED_SALT)) h = ((h ^ BigInt(c.charCodeAt(0))) * 1099511628211n) & 0xffffffffffffn; return h; };
