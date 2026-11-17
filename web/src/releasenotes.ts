/** The release notes: the one place to edit when a version ships. Newest first. Add an entry at the top, bump `version` in web/package.json to match.
 *  Items are plain text (escaped when shown). Keep them about what a player sees, not about code. */
export interface Release { version: string; date: string; title: string; added: string[]; changed: string[]; fixed: string[] }

export const RELEASES: Release[] = [
  {
    version: '0.2.0', date: '2026-11-16', title: 'Bosses, bridges and a proper food economy',
    added: [
      'Buy off raiders: when a bandit raid (or a boss raid) forms up at your gates, a Pay them off button in the red banner shows the price (what the raiders are worth, more for a boss) and, once you pay, they turn and walk away: no fight, no loot, but no glory or prize either. It only works before the first blow, never against another player, and the Ogre will not take coin. The bandits get greedy: the next raids come sooner and stronger and ask more, until it fades over a few days.',
      'Assign villagers yourself: in a building\'s panel, a slider with + and − and an Auto button sets how many workers it has (0 pauses it). Buildings you set are filled first, the rest share what is left. Click the workforce figure in the top bar for the work overview: every workplace by kind with its workers, status and output, filters for problems, "Auto-assign all" and "Pause all" per kind.',
      'Hover the rate of a resource in the top bar to light up the buildings behind it: rings on every building that makes it (+) or uses it (−), green when working, orange when held up (no workers, short of materials, store full) and gold when it can be upgraded right now. The tooltip lists each kind with its count, tiers, upgrades possible and why some stand idle; click the rate to look at each building in turn. The breakdown panel has the same list with a Show on map button.',
      'Bosses: the Warlord and the Ogre of the Marches, with lairs in the wild to find and clear.',
      'Fishing hut, smokehouse and bakery. The smokehouse smokes fish or meat; the hunter\'s lodge now brings in meat.',
      'Food mix: your people eat grain, fish, bread, meat and their smoked versions together, shown as one Food pill in the top bar.',
      'Resource ledger: click a resource to see what makes it and what uses it, with a steady per-day rate and the days of supply left.',
      'Market stock: buy basic goods for gold at the market; the stalls are refilled every day.',
      'Town hall backup supplies of wood and grain, so a village that runs dry can recover.',
      'Soldiers\' bridges: design a bridge for your army from bank to bank.',
      'Level Ground tool (Land category): levels a round patch of ground to the land just outside it, so a pit that raising could not fill is mended and a bump is cut away. Any ditch or earthworks inside the patch is taken away with it. Costs wood and stone; refused where a building stands in the patch or the ground round it is water.',
      'Road anchors while you place a building: the ring where its road joins the village (the circle a road snaps to) is drawn at its exact place and turns as you rotate the building, with the short stretch of road from its door to it, green when you can build and red when you cannot; any node or road it would join lights up in gold, so you can line buildings up with your roads.',
      'Gates, toll houses, bridges and drawbridges now have two road anchors, one at each end (the doorways of a gate or toll house, the banks of a bridge or drawbridge), so a road you lay snaps to both ends and runs through. A gate and a toll house show dirt or stone road under them (by castle tier); bridges and drawbridges show only their deck.',
      'Plaza: a paved square with a connection node on each of its four sides, and design options (benches, trees, a fountain, lanterns).',
      'Out-of-sync detection and repair: when a copy of another player\'s village drifts, the game notices and repairs it by itself.',
      'Rules fingerprint and build marker (see the home page and The shared world panel) so players can check they run the same version.',
      'This version number and the release notes page.',
      'Restart village (Display settings, at the bottom): pulls your whole village down and starts again from nothing on the same ground: buildings, roads, terrain changes (raised, lowered and levelled ground, moats, felled trees), deposits, stock, people, army, treaties and the day count. A confirmation sheet lists exactly what is lost and asks you to type your village\'s name; you can download a backup first, and the old village is kept once in this browser so you can bring it back. Other players see your village start again. Refused during a battle or while armies are out.',
      'See how far wells and towers reach: select or point at a well, a builders\' yard or a tower (or pick one to build) and rings are drawn on the ground, blue for fire fighting (full and half strength, and how close a well halves the chance a spark takes), teal for the yard\'s carpenters, orange-red for how far its archers shoot, each with a label; the building\'s panel lists the same radii. The new Show coverage button (key C) shows every well and every tower with archers in it at once, marks buildings no well reaches in amber and wall pieces no manned tower covers in red. The numbers come straight from the game rules, so what is drawn is what counts.',
    ],
    changed: [
      'The sync protocol is now version 3 (commands and hashes carry the epoch of your village\'s history, which a restart starts anew): players on older builds see "different game version" until they reload. The rules fingerprint is unchanged.',
      'Winter is gentler: farms make 55% grain (85% with haystacks) instead of 25%, the village burns about a third less firewood, the town hall hearth keeps it warm while any wood is left, and the cold now takes unhappiness first, nobody for the first 3 cold days (5 with a staffed hospital), then a daily chance that grows. Fishing, hunting and smoked food are untouched by winter.',
      'New Winter panel (click the season in the top bar, or hover it): exactly what winter does, firewood per day and days left at the present size, and a warning toast a season ahead.',
      'The rules fingerprint changed again for the winter rules: villages on this version only sync with players on the same version.',
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
      'Road junctions are clean, in dirt and in stone: a road that ends on another (a T), crosses it (an X) or meets two others (a Y) now starts at the edge of the road it joins instead of from its middle, and the dark soft edge is drawn only along the outside of the joined roads, no longer as a seam across the junction. Works at any angle, for curved roads and for the short paths of buildings. The texture of the joint runs on from each road without a darker block.',
      'Moat water no longer floats: on a slope, at a hill or beside a lowered or levelled patch the water of a moat used to stand above the lower bank and hang in the air; it now never rises above the lowest ground round a moat piece and changes level only gently along the moat.',
      'Finished buildings no longer start rebuilding for no reason: when another building was pulled down, burnt or lost in a raid, every building after it in the list played its construction animation again.',
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
