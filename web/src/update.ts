// Everybody plays the latest version. Two things tell a running page it is out of date: the site publishes `version.json` with every build (checked now and then), and another
// player's hello names a newer build than ours (net/sync.ts `isNewerBuild`). Either way the page saves and reloads itself; a reload that would not help (a cache that still serves the
// old build) is tried at most once per version, so nobody gets stuck in a loop.
// No imports from the game, so it runs under plain node (tests/update.test.mjs).

declare const __APP_ID__: string | undefined;
declare const __BUILD_TIME__: number | undefined;
/** Identifies this build (version, commit and the time it was made); `version.json` on the site holds the id of the build that is deployed. */
export const APP_ID: string = typeof __APP_ID__ === 'string' ? __APP_ID__ : 'dev';
/** When this build was made, in seconds since 1970 (0 in development): between two builds, the larger one is the newer. */
export const BUILD_TIME: number = typeof __BUILD_TIME__ === 'number' ? __BUILD_TIME__ : 0;

export interface Deployed { id: string; time: number }

/** What the site says is the current build, or null (offline, in development, a host that does not serve the file). */
export async function deployedBuild(fetcher: typeof fetch = fetch, base = ''): Promise<Deployed | null> {
  try {
    const r = await fetcher(`${base}version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json() as { id?: unknown; time?: unknown };
    return typeof j.id === 'string' && j.id.length > 0 && j.id.length < 200 ? { id: j.id, time: typeof j.time === 'number' ? j.time : 0 } : null;
  } catch { return null; }
}

/** Is the deployed build a different one from ours, and newer? (Development has no id of its own and never updates itself.) */
export function isOutdated(mine: string, deployed: Deployed | null, myTime = BUILD_TIME): boolean {
  if (!deployed || mine === 'dev' || deployed.id === mine) return false;
  return deployed.time === 0 || myTime === 0 || deployed.time > myTime;
}

const KEY = 'flanders:updated';
/** May we reload for `id` now? Once per deployed version per ten minutes: if the reload brought the same old build (a stale cache), a second one would not help either. */
export function mayReload(store: Pick<Storage, 'getItem' | 'setItem'>, id: string, now: number): boolean {
  try {
    const last = JSON.parse(store.getItem(KEY) ?? 'null') as { id?: string; at?: number } | null;
    if (last && last.id === id && typeof last.at === 'number' && now - last.at < 600_000) return false;
    store.setItem(KEY, JSON.stringify({ id, at: now }));
  } catch { /* storage blocked: allow it, the reload still only happens when a newer build is known */ }
  return true;
}

/** The address to reload: the same page with a parameter that makes caches fetch it again. */
export function reloadUrl(href: string, id: string): string {
  const u = new URL(href); u.searchParams.set('_u', id.slice(0, 40)); return u.toString();
}
