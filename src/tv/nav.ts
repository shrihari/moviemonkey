// Moving around with a TV remote. Arrow keys move focus to the nearest
// focusable element in that direction ("spatial navigation"). Anything with
// `data-nav` can take focus. Rows (`data-nav-group`) remember which card was
// focused, so coming back to a row lands where you left it.

export type Dir = 'left' | 'right' | 'up' | 'down';

const SELECTOR = '[data-nav]:not([disabled])';
const remembered = new WeakMap<Element, HTMLElement>();

/** The innermost open layer (a menu or dialog) traps focus; otherwise the page. */
function scope(): ParentNode {
  const layers = document.querySelectorAll('[data-nav-scope]');
  return layers.length ? layers[layers.length - 1] : document;
}

function shown(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

export function focusables(root: ParentNode = scope()): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(SELECTOR)).filter(shown);
}

function groupOf(el: Element): Element | null {
  return el.closest('[data-nav-group]');
}

export function focusEl(el: HTMLElement | null | undefined) {
  if (!el) return;
  el.focus({ preventScroll: true });
  const g = groupOf(el);
  if (g) remembered.set(g, el);
  reveal(el);
}

/** Focus the screen's default element (or the first one) if nothing is focused. */
export function focusDefault(root: ParentNode = scope(), id?: string | null) {
  const all = focusables(root);
  const byId = id ? all.find((e) => e.dataset.navId === id) : undefined;
  focusEl(byId ?? all.find((e) => e.hasAttribute('data-nav-default')) ?? all[0]);
}

export function move(dir: Dir): boolean {
  const all = focusables();
  const cur = document.activeElement as HTMLElement | null;
  if (!cur || !all.includes(cur)) {
    focusDefault();
    return true;
  }
  const r = cur.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const curGroup = groupOf(cur);
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of all) {
    if (el === cur) continue;
    const o = el.getBoundingClientRect();
    const ox = o.left + o.width / 2;
    const oy = o.top + o.height / 2;
    let main: number;
    let cross: number;
    if (dir === 'left' || dir === 'right') {
      if (dir === 'right' ? ox <= cx + 1 : ox >= cx - 1) continue;
      main = dir === 'right' ? o.left - r.right : r.left - o.right;
      // Prefer things on the same line: no vertical overlap costs a lot.
      const overlap = Math.min(o.bottom, r.bottom) - Math.max(o.top, r.top);
      cross = Math.abs(oy - cy) + (overlap > 0 ? 0 : 10_000);
    } else {
      if (dir === 'down' ? oy <= cy + 1 : oy >= cy - 1) continue;
      main = dir === 'down' ? o.top - r.bottom : r.top - o.bottom;
      cross = Math.abs(ox - cx);
    }
    const score = Math.max(main, 0) + cross * 2;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (!best) return false;
  // Entering another row: go back to the card you were on there.
  const g = groupOf(best);
  if (g && g !== curGroup && (dir === 'up' || dir === 'down')) {
    const prev = remembered.get(g);
    if (prev && prev.isConnected && shown(prev)) best = prev;
  }
  focusEl(best);
  return true;
}

/** Scroll the focused element into view inside its row and its page. */
export function reveal(el: HTMLElement) {
  const sx = el.closest<HTMLElement>('[data-scroll-x]');
  if (sx) {
    const pad = parseFloat(getComputedStyle(sx).paddingLeft) || 0;
    const sr = sx.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    const left = er.left - sr.left + sx.scrollLeft;
    let target = sx.scrollLeft;
    if (left - pad < sx.scrollLeft) target = left - pad;
    else if (left + er.width + pad > sx.scrollLeft + sx.clientWidth) target = left + er.width + pad - sx.clientWidth;
    if (target !== sx.scrollLeft) sx.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
  }
  const sy = el.closest<HTMLElement>('[data-scroll-y]');
  if (sy) {
    const row = el.closest<HTMLElement>('[data-nav-row]') ?? el;
    const sr = sy.getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    const top = rr.top - sr.top + sy.scrollTop;
    // Rows sit a quarter of the way down; the first one scrolls back to the top.
    const anchor = row.dataset.navRow === 'top' ? 0 : top - sy.clientHeight * 0.22;
    const fits = rr.top >= sr.top + sy.clientHeight * 0.08 && rr.bottom <= sr.bottom - sy.clientHeight * 0.04;
    if (row.dataset.navRow === 'top' || !fits || Math.abs(anchor - sy.scrollTop) > sy.clientHeight * 0.5) {
      sy.scrollTo({ top: Math.max(0, anchor), behavior: 'smooth' });
    }
  }
}

// ------------------------------------------------------------------ keys

export type Key = Dir | 'enter' | 'back' | 'play' | 'pause' | 'playpause' | 'stop' | 'ff' | 'rw' | 'digit';

/** Map a key event from a browser or a TV remote (LG, Samsung, Android TV). */
export function keyOf(e: KeyboardEvent): Key | null {
  switch (e.key) {
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'Enter':
      return 'enter';
    case 'Escape':
    case 'Backspace':
    case 'GoBack':
    case 'BrowserBack':
      return 'back';
    case 'MediaPlayPause':
      return 'playpause';
    case 'MediaPlay':
      return 'play';
    case 'MediaPause':
      return 'pause';
    case 'MediaStop':
      return 'stop';
    case 'MediaFastForward':
      return 'ff';
    case 'MediaRewind':
      return 'rw';
  }
  switch (e.keyCode) {
    case 461: // LG Back
    case 10009: // Samsung Return
      return 'back';
    case 415:
      return 'play';
    case 19:
      return 'pause';
    case 413:
      return 'stop';
    case 417:
      return 'ff';
    case 412:
      return 'rw';
  }
  if (digitOf(e) !== null) return 'digit';
  return null;
}

/** The number on a number key. Some TV browsers don't fill in `key`, so the key code counts too. */
export function digitOf(e: KeyboardEvent): string | null {
  if (/^[0-9]$/.test(e.key)) return e.key;
  if (e.keyCode >= 48 && e.keyCode <= 57) return String(e.keyCode - 48);
  if (e.keyCode >= 96 && e.keyCode <= 105) return String(e.keyCode - 96); // number pad
  return null;
}

type Handler = (key: Key, e: KeyboardEvent) => boolean | void;
const handlers: Handler[] = [];

/** Screens and overlays can take keys first; the newest one gets them first. */
export function onKeys(h: Handler): () => void {
  handlers.push(h);
  return () => {
    const i = handlers.lastIndexOf(h);
    if (i >= 0) handlers.splice(i, 1);
  };
}

export function installKeys(back: () => void): () => void {
  const onKey = (e: KeyboardEvent) => {
    const key = keyOf(e);
    if (!key) return;
    const target = e.target as HTMLElement;
    const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
    if (typing && (key === 'left' || key === 'right' || key === 'digit' || (key === 'back' && e.key === 'Backspace'))) {
      return;
    }
    for (let i = handlers.length - 1; i >= 0; i--) {
      if (handlers[i](key, e)) {
        e.preventDefault();
        return;
      }
    }
    if (key === 'left' || key === 'right' || key === 'up' || key === 'down') {
      e.preventDefault();
      move(key);
    } else if (key === 'back') {
      e.preventDefault();
      back();
    }
  };
  // Pointing with a mouse (or an LG Magic Remote) also moves focus.
  const onHover = (e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(SELECTOR);
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('mouseover', onHover);
  return () => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('mouseover', onHover);
  };
}
