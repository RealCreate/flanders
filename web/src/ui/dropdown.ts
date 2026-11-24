// A themed dropdown in place of the browser's own <select> menu. The <select> stays in the page (hidden) and stays the one source of truth: code that reads or sets its value,
// listens for `change`, or rebuilds its options keeps working. This only draws a button and a list over it.
// Every <select> is upgraded, also those added later (the diplomacy form is redrawn when players come and go). Opt out with data-native.

const done = new WeakSet<HTMLSelectElement>();
let openList: { list: HTMLElement; btn: HTMLButtonElement; close: () => void } | null = null;

function close() { openList?.close(); }

function upgrade(sel: HTMLSelectElement) {
  if (done.has(sel) || sel.multiple || sel.dataset.native !== undefined) return; done.add(sel);
  const wrap = document.createElement('span'); wrap.className = 'dd';
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'dd-btn';
  btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false');
  sel.before(wrap); wrap.append(sel, btn);
  sel.classList.add('dd-native'); sel.tabIndex = -1; sel.setAttribute('aria-hidden', 'true');
  sel.addEventListener('focus', () => btn.focus());   // a <label for> that points at the select lands on the button

  const text = () => sel.selectedOptions[0]?.text ?? '';
  const refresh = () => {
    btn.textContent = text(); btn.disabled = sel.disabled; btn.title = sel.title || '';
    const label = sel.getAttribute('aria-label'); if (label) btn.setAttribute('aria-label', `${label}: ${text()}`); else btn.removeAttribute('aria-label');
  };
  // code sets `select.value = …` without an event: follow it
  const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!;
  Object.defineProperty(sel, 'value', { configurable: true, get() { return desc.get!.call(sel); }, set(v: string) { desc.set!.call(sel, v); refresh(); } });
  sel.addEventListener('change', refresh);
  new MutationObserver(refresh).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'label', 'aria-label'] });
  refresh();

  function show() {
    close();
    const list = document.createElement('ul'); list.className = 'dd-list'; list.setAttribute('role', 'listbox'); list.tabIndex = -1;
    let active = Math.max(0, sel.selectedIndex);
    const items = [...sel.options].map((o, i) => {
      const li = document.createElement('li'); li.setAttribute('role', 'option'); li.textContent = o.text; li.dataset.i = String(i);
      li.setAttribute('aria-selected', String(i === sel.selectedIndex)); if (o.disabled) li.setAttribute('aria-disabled', 'true');
      list.append(li); return li;
    });
    const mark = (i: number) => { active = i; items.forEach((li, k) => li.classList.toggle('on', k === i)); items[i]?.scrollIntoView({ block: 'nearest' }); };
    const choose = (i: number) => {
      if (!sel.options[i] || sel.options[i].disabled) return;
      const changed = sel.selectedIndex !== i; sel.selectedIndex = i; refresh(); closeIt();
      if (changed) { sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); }
    };
    const place = () => {
      const r = btn.getBoundingClientRect(), below = innerHeight - r.bottom, up = below < 180 && r.top > below;
      list.style.minWidth = r.width + 'px'; list.style.left = Math.max(4, Math.min(r.left, innerWidth - list.offsetWidth - 4)) + 'px';
      list.style.maxHeight = Math.max(120, (up ? r.top : below) - 12) + 'px';
      list.style.top = up ? Math.max(4, r.top - list.offsetHeight - 2) + 'px' : r.bottom + 2 + 'px';
    };
    const onDown = (e: Event) => { if (!list.contains(e.target as Node) && !btn.contains(e.target as Node)) closeIt(); };
    const onKey = (e: KeyboardEvent) => {
      const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
      if (e.key === 'Escape') { stop(); closeIt(); btn.focus(); }
      else if (e.key === 'ArrowDown') { stop(); mark(Math.min(items.length - 1, active + 1)); }
      else if (e.key === 'ArrowUp') { stop(); mark(Math.max(0, active - 1)); }
      else if (e.key === 'Home') { stop(); mark(0); } else if (e.key === 'End') { stop(); mark(items.length - 1); }
      else if (e.key === 'Enter' || e.key === ' ') { stop(); choose(active); btn.focus(); }
      else if (e.key === 'Tab') closeIt();
      else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {   // type to jump
        const at = items.findIndex((li, k) => k > active && li.textContent!.toLowerCase().startsWith(e.key.toLowerCase())), from = at >= 0 ? at : items.findIndex(li => li.textContent!.toLowerCase().startsWith(e.key.toLowerCase()));
        if (from >= 0) { stop(); mark(from); }
      }
    };
    function closeIt() {
      list.remove(); btn.setAttribute('aria-expanded', 'false');
      removeEventListener('keydown', onKey, true); removeEventListener('pointerdown', onDown, true); removeEventListener('wheel', onWheel, true); removeEventListener('resize', closeIt);
      if (openList?.list === list) openList = null;
    }
    const onWheel = (e: Event) => { if (!list.contains(e.target as Node)) closeIt(); };
    list.addEventListener('pointerdown', e => e.preventDefault());   // keep the focus on the button
    list.addEventListener('click', e => { const li = (e.target as HTMLElement).closest<HTMLElement>('li'); if (li) { choose(Number(li.dataset.i)); btn.focus(); } });
    list.addEventListener('pointermove', e => { const li = (e.target as HTMLElement).closest<HTMLElement>('li'); if (li) mark(Number(li.dataset.i)); });
    document.body.append(list); place(); mark(active);
    btn.setAttribute('aria-expanded', 'true');
    addEventListener('keydown', onKey, true); addEventListener('pointerdown', onDown, true); addEventListener('wheel', onWheel, { capture: true, passive: true }); addEventListener('resize', closeIt);
    openList = { list, btn, close: closeIt };
  }
  btn.addEventListener('click', () => { if (openList?.btn === btn) close(); else show(); });
  btn.addEventListener('keydown', e => { if (['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); show(); } });
}

/** Upgrade every <select> under `root`, and keep upgrading the ones that appear later. */
export function mountDropdowns(root: HTMLElement = document.body) {
  root.querySelectorAll('select').forEach(s => upgrade(s as HTMLSelectElement));
  new MutationObserver(list => {
    for (const m of list) m.addedNodes.forEach(n => {
      if (n instanceof HTMLSelectElement) upgrade(n);
      else if (n instanceof HTMLElement && n.firstElementChild) n.querySelectorAll('select').forEach(s => upgrade(s as HTMLSelectElement));
    });
  }).observe(root, { childList: true, subtree: true });
}
