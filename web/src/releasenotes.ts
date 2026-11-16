/** The release notes: the one place to edit when a version ships. Newest first. Add an entry at the top, bump `version` in web/package.json to match.
 *  Items are plain text (escaped when shown). Keep them about what a player sees, not about code. */
export interface Release { version: string; date: string; title: string; added: string[]; changed: string[]; fixed: string[] }

export const RELEASES: Release[] = [
  {
    version: '0.2.0', date: '2026-11-16', title: 'Bosses, bridges and a proper food economy',
    added: [
      'Bosses: the Warlord and the Ogre of the Marches, with lairs in the wild to find and clear.',
      'Fishing hut, smokehouse and bakery. The smokehouse smokes fish or meat; the hunter\'s lodge now brings in meat.',
      'Food mix: your people eat grain, fish, bread, meat and their smoked versions together, shown as one Food pill in the top bar.',
      'Resource ledger: click a resource to see what makes it and what uses it, with a steady per-day rate and the days of supply left.',
      'Market stock: buy basic goods for gold at the market; the stalls are refilled every day.',
      'Town hall backup supplies of wood and grain, so a village that runs dry can recover.',
      'Soldiers\' bridges: design a bridge for your army from bank to bank.',
      'Level Ground tool (Land category): levels a round patch of ground to the land just outside it, so a pit that raising could not fill is mended and a bump is cut away. Any ditch or earthworks inside the patch is taken away with it. Costs wood and stone; refused where a building stands in the patch or the ground round it is water.',
      'Plaza: a paved square with a connection node on each of its four sides, and design options (benches, trees, a fountain, lanterns).',
      'Out-of-sync detection and repair: when a copy of another player\'s village drifts, the game notices and repairs it by itself.',
      'Rules fingerprint and build marker (see the home page and The shared world panel) so players can check they run the same version.',
      'This version number and the release notes page.',
    ],
    changed: [
      'Deposits are far bigger (stone, clay, iron and gold last for months of mining) and are never gone for good: a used-up deposit goes dormant (greyed, no ore, its mine says "Deposit dormant") and slowly regrows, a little faster when nobody works it, waking again at 15%. Mine and quarry panels show what is left, how many days it lasts and how far a dormant deposit has recovered. Deposits you clear away stay cleared. Forests are unchanged.',
      'Armies cross water only by a bridge or a temporarily lowered drawbridge.',
      'Combat overhaul: defending, raiders, siege engines, fire and rams all behave more distinctly.',
      'Knights and siege engines march at their own pace.',
      'Roads are laid by you now: click the points of a road and it runs in a smooth curve through them. The automatic roads between buildings are gone (they caused too many tangles); the invisible paths people and soldiers walk are unchanged, and they prefer the roads you lay.',
      'Every building has its own short path from its door to a node at the edge of its plot; a road you lay snaps onto it. Roads that join the village widen the land you may build on and may lead out beyond its edge (within a limit).',
      'The rules fingerprint changed: villages on this version only sync with players on the same version. Old roads that were laid automatically simply disappear; road pieces you laid yourself stay and are joined to their neighbours.',
      'Roads are dirt tracks, dark and clearly visible against the grass, while your castle is in its first tiers, and cobbled stone from tier 2; every road in the village changes when the castle is upgraded.',
      'The ground is graded under every road: it follows the land smoothly, is level across its width and never climbs steeper than a walkable slope, eased into the hillside on each side, and it never fills in a river or moat beside it.',
      'Trade and diplomacy journeys between villages are shown as processions walking the road.',
      'Hand-drawn icons replace the emoji, including new resource icons and a redrawn charcoal burner.',
      'Raids come about once a week instead of more often.',
      'Staff go to food and wood workplaces first.',
      'Plagues last longer.',
    ],
    fixed: [
      'Waterwheels and watermills stand at the visible water level of a moat and sit on the bank, with the wheel dipping into the water.',
      'Fishing hut, gold mine and iron mine footings no longer glitch against the bank or the door pad.',
      'Drawbridges snap to face outward across the moat.',
      'Roads are no longer drawn across a moat or river or under a drawbridge: they stop at the bank. A road you lay shows the moment you lay it instead of growing in over the next day.',
      'A black beam over olive branches and scrolls.',
      'Jumping a moat, clicking mines, spires and upgrades that could only be added.',
    ],
  },
  {
    version: '0.1.0', date: '2026-11-14', title: 'The first playable world',
    added: [
      'A shared medieval world with no server: players\' browsers connect to each other, and a map link brings friends to the same world.',
      'Villages with families, ages, seasons and winter firewood; markets, caravans and treaties; diplomacy, churches, hospitals and graveyards.',
      'Armies, morale, heroes, hoardings that pour boiling oil, toll posts, scouts and fog of war.',
      'Player-drawn roads and bridges, gates and tunnels, wall walks with stairs, and a flag designer.',
      'Playable on GitHub Pages, straight in the browser.',
    ],
    changed: ['Better water with depth colour, shore foam and ripples, and a bigger map.', 'Much faster rendering.'],
    fixed: ['Gate and hoarding fixes, and a checked population counter.'],
  },
];

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** The notes page body as HTML: one section per version, newest first, each with its New / Changed / Fixed groups (empty groups are left out). */
export function renderNotes(releases: Release[] = RELEASES): string {
  const group = (name: string, items: string[]) => items.length ? `<h4>${name}</h4><ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : '';
  return releases.map(r => `<section class="release"><h3>${esc(r.version)} <small>${esc(r.date)}</small></h3><p class="muted">${esc(r.title)}</p>${group('New', r.added)}${group('Changed', r.changed)}${group('Fixed', r.fixed)}</section>`).join('');
}
