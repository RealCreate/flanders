// The "Start the village again" dialog: what will be lost, what stays, a backup button, and a phrase to type. The rules are in restart.ts (RestartFlow); this only draws them.
import { RestartFlow, lossLines, KEPT_LINES, CONFIRM_WORD, ARM_MS, type Facts } from '../restart';
import { icon } from './icons';

export interface RestartInfo {
  facts: Facts; name: string;
  /** The village archived by the last restart (it can be brought back once), if there is one. */
  archive: { archivedAt: number; days: number; buildings: number } | null;
}
export interface RestartHooks {
  info(): Promise<RestartInfo>;
  /** Do it. Resolves to null when done, or to what went wrong. */
  run(): Promise<string | null>;
  /** Bring the archived village back. Resolves to null when done, or to what went wrong. */
  restore(): Promise<string | null>;
  /** Download the backup file; resolves to the number of items it holds. */
  backup(): number;
  toast(text: string, tone?: string): void;
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

/** Wire the dialog into `overlay` (an element with a `.sheet` inside). Returns what the settings panel needs: `open()` shows it. */
export function mountRestart(overlay: HTMLElement, h: RestartHooks) {
  const sheet = overlay.querySelector<HTMLElement>('.sheet')!;
  let flow = new RestartFlow('');
  let timer = 0;
  const close = () => { clearInterval(timer); flow.cancel(); if (flow.state === 'closed') overlay.hidden = true; };

  function draw(info: RestartInfo) {
    const now = Date.now();
    if (flow.state === 'blocked') {
      sheet.innerHTML = `<h2>Start the village again</h2><p>${esc(flow.blockedBy)}</p><div class="btnrow"><button class="pbtn primary" id="rs-close">Close</button></div>`;
      sheet.querySelector<HTMLElement>('#rs-close')!.onclick = close; return;
    }
    const f = info.facts;
    sheet.innerHTML = `<h2>${icon('restart', 22)} Start the village again</h2>
      <p><b>This pulls down your whole village and begins again from nothing</b>, on the same ground, as if you had just arrived. Other players see your village disappear and a new one begin.</p>
      <h3>What you lose</h3><ul class="rs-list">${lossLines(f).map(l => `<li>${esc(l)}</li>`).join('')}</ul>
      <h3>What stays</h3><ul class="rs-list">${KEPT_LINES.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
      <div class="btnrow"><button class="pbtn" id="rs-backup">${icon('copy', 16, { mono: true })} Download a backup of this village first</button></div>
      <p class="muted" id="rs-backup-msg" role="status">${flow.backedUp ? 'Backup file saved. Keep it safe: it holds your private key.' : 'Optional. The game also keeps this village once, so you can bring it back from this menu.'}</p>
      <label for="rs-type">To go on, type <b>${esc(info.name)}</b> (your village's name) or <b>${CONFIRM_WORD}</b></label>
      <input id="rs-type" type="text" autocomplete="off" spellcheck="false" maxlength="40" value="${esc(flow.typed)}">
      <p class="muted" id="rs-err" role="alert" style="color:var(--bad)">${esc(flow.error)}</p>
      <div class="btnrow"><button class="pbtn" id="rs-no">Keep my village</button><button class="pbtn danger" id="rs-yes" disabled>Pull it all down</button></div>`;
    const type = sheet.querySelector<HTMLInputElement>('#rs-type')!, yes = sheet.querySelector<HTMLButtonElement>('#rs-yes')!;
    const refresh = () => { yes.disabled = !flow.canConfirm(Date.now()); };
    type.oninput = () => { flow.type(type.value); refresh(); };
    sheet.querySelector<HTMLElement>('#rs-no')!.onclick = close;
    sheet.querySelector<HTMLElement>('#rs-backup')!.onclick = () => {
      try { const n = h.backup(); flow.backedUp = true; sheet.querySelector<HTMLElement>('#rs-backup-msg')!.textContent = `Backup file saved (${n} items). Keep it safe: it holds your private key.`; }
      catch (e) { sheet.querySelector<HTMLElement>('#rs-backup-msg')!.textContent = `Could not save the backup: ${(e as Error).message}`; }
    };
    yes.onclick = async () => {
      if (!flow.confirm(Date.now())) return;
      yes.disabled = true; yes.textContent = 'Starting again…'; type.disabled = true;
      const err = await h.run();
      if (err) { flow.fail(err); draw(info); return; }
      flow.done(); clearInterval(timer); overlay.hidden = true;
    };
    clearInterval(timer);
    timer = window.setInterval(() => { if (!overlay.hidden) refresh(); }, 250);
    setTimeout(refresh, ARM_MS + 20); type.focus();
  }

  async function open() {
    const info = await h.info();
    flow = new RestartFlow(info.name);
    flow.open({ ...info.facts, now: Date.now() });
    overlay.hidden = false; draw(info);
  }
  overlay.addEventListener('pointerdown', e => { if (e.target === overlay) close(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !overlay.hidden) { e.stopPropagation(); close(); } }, true);

  /** The part of the settings panel: a heading, one sentence and a button (and a second one when an archived village waits). */
  async function drawSection(root: HTMLElement) {
    const info = await h.info();
    const a = info.archive;
    root.innerHTML = `<h3>Start again</h3><p class="muted">Pulls down your whole village (buildings, ground, stock, people, army, treaties and the day count) and begins a new one on the same spot. You are asked to confirm, and the old village is kept once so you can bring it back.</p>
      <div class="btnrow"><button class="pbtn danger" id="rs-open">${icon('restart', 16, { mono: true })} Restart village…</button>${a ? `<button class="pbtn" id="rs-restore" title="Brings back the village that was pulled down on ${esc(new Date(a.archivedAt).toLocaleString())} (day ${a.days}, ${a.buildings} buildings). The village you have now is lost.">Bring back the old village (day ${a.days})…</button>` : ''}</div><p class="muted" id="rs-msg" role="status"></p>`;
    root.querySelector<HTMLElement>('#rs-open')!.onclick = () => { void open(); };
    const r = root.querySelector<HTMLElement>('#rs-restore');
    if (r) r.onclick = async () => {
      const msg = root.querySelector<HTMLElement>('#rs-msg')!;
      msg.textContent = 'Bringing the old village back…';
      const err = await h.restore();
      msg.textContent = err ?? '';
      if (!err) void drawSection(root);
    };
  }
  return { open, drawSection };
}
