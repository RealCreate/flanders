import { icon } from './ui/icons';
// The bar at the bottom of the screen while you watch a history: play/pause, speed, a slider through time, and a way back to the live game.
const CSS = `
#replay-bar { position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); z-index: 65; width: min(720px, 94vw); display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px 12px;
  border-radius: 8px; background: #1d150df0; border: 1px solid #c9a24a; color: #f1e4c3; font: 14px system-ui, sans-serif; }
#replay-bar button, #replay-bar select { cursor: pointer; padding: 5px 10px; border-radius: 6px; border: 1px solid #c9a24a; background: #3a2c18; color: #f1e4c3; font: inherit; }
#replay-bar input[type=range] { flex: 1 1 240px; min-width: 160px; }
#replay-bar .rt { min-width: 150px; font-variant-numeric: tabular-nums; }
#replay-bar b { color: #ffd98a; }
`;

export interface ReplayBarHandlers { toggle(): void; seek(tick: number): void; rate(ticksPerSecond: number): void; exit(): void }
export interface ReplayBar { update(tick: number, end: number, playing: boolean): void; remove(): void }

export const RATES: [string, number][] = [['slow', 8], ['normal', 30], ['fast', 120], ['very fast', 480]];

export function showReplayBar(title: string, end: number, h: ReplayBarHandlers): ReplayBar {
  if (!document.getElementById('replay-style')) { const st = document.createElement('style'); st.id = 'replay-style'; st.textContent = CSS; document.head.appendChild(st); }
  const bar = document.createElement('div'); bar.id = 'replay-bar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Replay');
  const name = document.createElement('b'); name.textContent = title;
  const play = document.createElement('button'); play.innerHTML = `${icon('pause', 14, { mono: true })} Pause`; play.onclick = () => h.toggle();
  const rate = document.createElement('select'); rate.title = 'Speed'; for (const [n, v] of RATES) { const o = document.createElement('option'); o.value = String(v); o.textContent = n; rate.appendChild(o); } rate.value = '120';
  rate.onchange = () => h.rate(Number(rate.value));
  const slider = document.createElement('input'); slider.type = 'range'; slider.min = '0'; slider.max = String(end); slider.value = '0'; slider.setAttribute('aria-label', 'Time');
  let dragging = false; slider.oninput = () => { dragging = true; h.seek(Number(slider.value)); }; slider.onchange = () => { dragging = false; };
  const when = document.createElement('span'); when.className = 'rt';
  const exit = document.createElement('button'); exit.innerHTML = `${icon('close', 12, { mono: true })} Back to the game`; exit.onclick = () => h.exit();
  bar.append(name, play, rate, slider, when, exit); document.body.appendChild(bar);
  return {
    update(tick, last, playing) {
      play.innerHTML = `${icon(playing ? 'pause' : tick >= last ? 'again' : 'play', 14, { mono: true })} ${playing ? 'Pause' : tick >= last ? 'Again' : 'Play'}`;
      slider.max = String(last); if (!dragging) slider.value = String(tick);
      when.textContent = `Day ${Math.floor(tick / 240) + 1} · ${tick} / ${last}`;
    },
    remove() { bar.remove(); },
  };
}
