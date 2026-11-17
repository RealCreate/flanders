// Buying off raiders (core: crates/game-core/src/bribe.rs). Pure helpers for the texts and the state of the "Pay them off" button, so they can be tested under plain node.

/** What the button shows and whether it can be pressed. `price` is `World.bribe_price()` (-1 when the raiders cannot be bought off), `gold` the stores' gold, `greed` `World.bribe_greed()`. */
export interface BribeOffer { show: boolean; price: number; label: string; disabled: boolean; reason: string; title: string }

/** What paying costs you beyond the coins, said plainly. */
export const BRIBE_CONSEQUENCE = 'They will return sooner and stronger, and a victory\'s glory and loot are forgone.';

export function bribeOffer(price: number, gold: number, greed = 0): BribeOffer {
  if (!(price >= 0)) return { show: false, price: -1, label: '', disabled: true, reason: '', title: '' };
  const poor = gold < price;
  const more = greed > 0 ? ' You paid them not long ago: they ask more, and they will be back even sooner.' : '';
  const reason = poor ? `You need ${price - gold} more gold in the stores.` : '';
  return { show: true, price, label: `Pay them off (${price})`, disabled: poor, reason, title: poor ? reason : `Pay ${price} gold and the raiders turn back. ${BRIBE_CONSEQUENCE}${more}` };
}

/** The report of a purchase: who took how many coins. `boss` is the boss that led the raid (0 none, 1 warlord). */
export function bribedText(coins: number, boss: number): string {
  return boss === 1 ? `The Warlord's raiders took ${coins} coins and left.` : `The bandits took ${coins} coins and left.`;
}

/** The toast when the player pays. */
export function bribeToast(coins: number, boss: number): string {
  return `You pay ${coins} gold${boss === 1 ? ' to the Warlord' : ''}. ${BRIBE_CONSEQUENCE}`;
}

/** Why a refused `bribe()` was refused: -6 too poor, anything else not allowed (no raid, it has begun, a player's army, or a boss that will not be bought). */
export function bribeRefusal(code: number, price: number, gold: number): string {
  return code === -6 ? `You need ${Math.max(0, price - gold)} more gold to pay them off.` : 'They cannot be bought off now: only a bandit raid that has not yet struck, and not every leader will take coin.';
}
