// Runs before the game: checks the browser can play it, and catches errors the game does not handle so the player sees a message (and a way to save their village)
// instead of a frozen page. Imported first in main.ts; if the browser cannot play, it stops the game from starting by throwing.
import { downloadBackup } from './backup';

const STYLE = 'position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:#17110bf2;color:#f1e4c3;font:16px/1.5 system-ui,sans-serif;padding:24px';
const BTN = 'cursor:pointer;margin:6px 6px 0 0;padding:8px 14px;border-radius:6px;border:1px solid #c9a24a;background:#3a2c18;color:#f1e4c3;font:inherit';

function overlay(title: string, body: string, buttons: [string, () => void][]) {
  document.getElementById('boot-msg')?.remove();
  const d = document.createElement('div'); d.id = 'boot-msg'; d.setAttribute('role', 'alertdialog'); d.style.cssText = STYLE;
  const box = document.createElement('div'); box.style.cssText = 'max-width:520px';
  const h = document.createElement('h2'); h.textContent = title; h.style.cssText = 'margin:0 0 8px;font-family:serif';
  const p = document.createElement('p'); p.textContent = body; p.style.margin = '0 0 10px';
  box.append(h, p);
  for (const [label, fn] of buttons) { const b = document.createElement('button'); b.textContent = label; b.style.cssText = BTN; b.onclick = fn; box.appendChild(b); }
  d.appendChild(box); document.body.appendChild(d);
}

/** What this browser lacks, in words a player understands; empty when it can play. */
export function missingFeatures(): string[] {
  const miss: string[] = [];
  if (typeof WebAssembly !== 'object') miss.push('WebAssembly');
  try { const c = document.createElement('canvas'); if (!c.getContext('webgl2')) miss.push('WebGL 2 (graphics acceleration)'); } catch { miss.push('WebGL 2 (graphics acceleration)'); }
  if (!globalThis.crypto?.subtle || !globalThis.isSecureContext) miss.push('a secure connection (https) for signing');
  return miss;
}

const missing = missingFeatures();
if (missing.length) {
  overlay('This browser cannot run Flanders', `It needs ${missing.join(', ')}. Try a recent version of Chrome, Edge, Firefox or Safari, check that hardware acceleration is switched on, and open the game over https.`, []);
  throw new Error('unsupported browser: ' + missing.join(', '));
}
// Ed25519 signing is newer than the rest: test it for real rather than guess from the browser name
try { await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']); } catch {
  overlay('Your browser is too old for multiplayer signing', 'Flanders signs your commands with Ed25519, which needs Chrome/Edge 137, Firefox 129 or Safari 17 or newer. Please update your browser.', []);
  throw new Error('unsupported browser: Ed25519');
}

let shown = false;
function crashed(what: unknown) {
  console.error('Unhandled error:', what);
  if (shown) return; shown = true;   // one message is enough: a loop of errors should not bury the player
  overlay('Something went wrong', 'The game hit an unexpected error. Your village is saved in this browser every few seconds; reloading usually fixes it. If it keeps happening, save a backup file first.', [
    ['Reload', () => location.reload()],
    ['Save a backup', () => { try { downloadBackup(); } catch (e) { console.error(e); } }],
    ['Keep playing', () => { document.getElementById('boot-msg')?.remove(); shown = false; }],
  ]);
}
addEventListener('error', e => { if (e.message && /ResizeObserver loop/.test(e.message)) return; crashed(e.error ?? e.message); });
// a failed promise (a relay that is down, a peer that left) is routine on a peer-to-peer network: log it, do not interrupt the player
addEventListener('unhandledrejection', e => console.warn('Unhandled promise rejection:', e.reason));
addEventListener('webglcontextlost', e => { e.preventDefault(); overlay('The graphics were reset', 'The browser took the graphics card away from the game (this happens when it is overloaded or the computer sleeps). Reload to continue; your village is saved.', [['Reload', () => location.reload()]]); }, true);
