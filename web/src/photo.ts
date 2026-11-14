// Photo mode: hides the interface so you can fly the camera and save a picture of your village. F9 (or the camera button in Display settings) toggles it.
const STYLE_ID = 'photo-style';
const CSS = `
body.photo-mode #app > *:not(#stage) { display: none !important; }
body.photo-mode #stage .vignette, body.photo-mode #stage #labels { display: none !important; }
#photo-bar { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 70; display: flex; gap: 8px; align-items: center; padding: 8px 12px; border-radius: 8px;
  background: #1d150dd9; border: 1px solid #c9a24a; color: #f1e4c3; font: 14px system-ui, sans-serif; opacity: .35; transition: opacity .25s; }
#photo-bar:hover, #photo-bar:focus-within { opacity: 1; }
#photo-bar button { cursor: pointer; padding: 6px 12px; border-radius: 6px; border: 1px solid #c9a24a; background: #3a2c18; color: #f1e4c3; font: inherit; }
`;

let bar: HTMLElement | null = null;

export const photoModeOn = () => document.body.classList.contains('photo-mode');

/** Turn photo mode on or off. `draw` must render one frame to the canvas right now (the picture is taken from it); `canvas` is the game canvas. */
export function togglePhotoMode(canvas: HTMLCanvasElement, draw: () => void, toast: (m: string) => void) {
  if (photoModeOn()) { document.body.classList.remove('photo-mode'); bar?.remove(); bar = null; return; }
  if (!document.getElementById(STYLE_ID)) { const st = document.createElement('style'); st.id = STYLE_ID; st.textContent = CSS; document.head.appendChild(st); }
  document.body.classList.add('photo-mode');
  bar = document.createElement('div'); bar.id = 'photo-bar'; bar.setAttribute('role', 'toolbar');
  const note = document.createElement('span'); note.textContent = 'Photo mode · move and turn the camera as usual';
  const shot = document.createElement('button'); shot.textContent = '📷 Save picture'; shot.onclick = () => savePicture(canvas, draw, toast);
  const exit = document.createElement('button'); exit.textContent = 'Back to the game (F9)'; exit.onclick = () => togglePhotoMode(canvas, draw, toast);
  bar.append(note, shot, exit); document.body.appendChild(bar);
}

/** Save what the camera sees as a PNG file. */
export function savePicture(canvas: HTMLCanvasElement, draw: () => void, toast: (m: string) => void) {
  draw();   // the canvas is only readable straight after drawing it
  canvas.toBlob(blob => {
    if (!blob) { toast('Could not take the picture.'); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `flanders-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }, 'image/png');
}
