// One manager for every pop-up page in the game (`.overlay` elements): a stack, so a page opened from another sits on top of it and Esc peels them off one at a time;
// a focus trap with focus handed back to whatever opened the page; the dialog roles; and the stacking order, which is decided here (see --z-* in style.css) and not in each page's own style.
// Pages are plain `.overlay` elements. `hidden` is the single truth for open/closed, so a page opened or closed by anything else is picked up too (a MutationObserver keeps the stack right).
// An overlay with `data-static` (the loading screen, the start page) is not a pop-up: it is never stacked and Esc does not close it.

export interface ModalGuard {
  /** Called before the page is closed by Esc, the backdrop, a Close button or `modals.close`. Return false to keep it open (a flow that has to be cancelled first). */
  beforeClose?: () => boolean | void;
  /** Called once the page has closed, however that happened. */
  afterClose?: () => void;
}

const BASE_Z = 21;   // static overlays sit at 20 (see .overlay); pop-ups stack above them
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

const stack: HTMLElement[] = [];
const openers = new WeakMap<HTMLElement, HTMLElement | null>();
const guards = new Map<string, ModalGuard>();
const watched = new WeakSet<HTMLElement>();
let ready = false;

const visible = (el: HTMLElement) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
const focusables = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
const isPopup = (el: HTMLElement) => el.classList.contains('overlay') && el.dataset.static === undefined;

function layout() { stack.forEach((el, i) => { el.style.zIndex = String(BASE_Z + i); }); }

function describe(el: HTMLElement) {
  const sheet = el.querySelector<HTMLElement>('.sheet'); if (!sheet) return;
  if (!sheet.getAttribute('role')) sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  if (!sheet.hasAttribute('aria-labelledby') && !sheet.hasAttribute('aria-label')) {
    const heading = sheet.querySelector<HTMLElement>('h1,h2'); if (heading) { heading.id ||= `${el.id}-heading`; sheet.setAttribute('aria-labelledby', heading.id); }
  }
  if (!sheet.hasAttribute('tabindex')) sheet.tabIndex = -1;
}

function opened(el: HTMLElement) {
  if (stack.includes(el)) return;
  const active = document.activeElement as HTMLElement | null;
  openers.set(el, active && active !== document.body && !el.contains(active) ? active : null);
  stack.push(el); layout(); describe(el);
  // focus: whatever the page asks for, else its first control, else the page itself
  queueMicrotask(() => {
    if (el.hidden || el.contains(document.activeElement)) return;
    const sheet = el.querySelector<HTMLElement>('.sheet') ?? el;
    (el.querySelector<HTMLElement>('[autofocus]') ?? focusables(sheet)[0] ?? sheet).focus({ preventScroll: true });
  });
}

function closed(el: HTMLElement) {
  const i = stack.indexOf(el); if (i < 0) return;
  stack.splice(i, 1); el.style.zIndex = ''; layout();
  const back = openers.get(el); openers.delete(el);
  if (back && document.contains(back) && visible(back)) back.focus({ preventScroll: true });
  guards.get(el.id)?.afterClose?.();
}

function sync(el: HTMLElement) { if (el.hidden) closed(el); else opened(el); }

function watch(el: HTMLElement) {
  if (watched.has(el) || !isPopup(el)) return; watched.add(el);
  new MutationObserver(() => sync(el)).observe(el, { attributes: true, attributeFilter: ['hidden'] });
  // a click on the dimmed backdrop (outside the sheet) closes the page
  el.addEventListener('pointerdown', e => { if (e.target === el) modals.close(el.id); });
  if (!el.hidden) opened(el);
}

function onKey(e: KeyboardEvent) {
  const top = stack[stack.length - 1]; if (!top) return;
  if (document.querySelector('.dd-list')) return;   // an open dropdown takes Esc and the arrow keys first (ui/dropdown.ts)
  if (e.key === 'Escape' && !e.isComposing) { e.preventDefault(); e.stopPropagation(); modals.close(top.id); return; }
  if (e.key !== 'Tab') return;
  const list = focusables(top.querySelector<HTMLElement>('.sheet') ?? top); if (!list.length) { e.preventDefault(); return; }
  const first = list[0], last = list[list.length - 1], at = document.activeElement;
  if (!top.contains(at)) { e.preventDefault(); first.focus(); }
  else if (e.shiftKey && (at === first || at === top.querySelector('.sheet'))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
}

export const modals = {
  /** Find every page in the document and start managing it. Safe to call again after pages are added. */
  mount(root: ParentNode = document) {
    root.querySelectorAll<HTMLElement>('.overlay').forEach(watch);
    if (!ready) { ready = true; addEventListener('keydown', onKey, true); }
  },
  /** Say what has to happen around closing one page. */
  guard(id: string, g: ModalGuard) { guards.set(id, g); },
  open(id: string) { const el = document.getElementById(id); if (el) { watch(el); el.hidden = false; sync(el); } },
  /** Close a page (after its guard agrees). Returns whether it is now closed. */
  close(id: string): boolean {
    const el = document.getElementById(id); if (!el) return true;
    if (el.hidden) return true;
    if (guards.get(id)?.beforeClose?.() === false) return false;
    el.hidden = true; sync(el); return true;
  },
  /** Close the page on top, if any. */
  closeTop(): boolean { const top = stack[stack.length - 1]; return top ? modals.close(top.id) : false; },
  isOpen(id: string) { const el = document.getElementById(id); return !!el && !el.hidden; },
  /** True while any pop-up is open (game keys should stay out of the way). */
  any() { return stack.length > 0; },
  top() { return stack[stack.length - 1]?.id ?? null; },
};
