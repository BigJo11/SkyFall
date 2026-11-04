// Rebinding. Every key the game asks for goes through an action name, so the
// options screen can swap the physical key under it without the rest of the
// code knowing. Bindings live in localStorage and are read at boot.

export const ACTIONS = [
  { id: 'forward', label: 'FORWARD', group: 'MOVEMENT', def: 'KeyW', alt: ['ArrowUp'] },
  { id: 'back', label: 'BACK', group: 'MOVEMENT', def: 'KeyS', alt: ['ArrowDown'] },
  { id: 'left', label: 'LEFT', group: 'MOVEMENT', def: 'KeyA', alt: ['ArrowLeft'] },
  { id: 'right', label: 'RIGHT', group: 'MOVEMENT', def: 'KeyD', alt: ['ArrowRight'] },
  { id: 'sprint', label: 'SPRINT', group: 'MOVEMENT', def: 'ShiftLeft', alt: ['ShiftRight'] },
  { id: 'jump', label: 'JUMP', group: 'MOVEMENT', def: 'Space' },
  { id: 'slide', label: 'SLIDE', group: 'MOVEMENT', def: 'KeyC', alt: ['ControlLeft', 'ControlRight'] },
  { id: 'reload', label: 'RELOAD', group: 'COMBAT', def: 'KeyR' },
  { id: 'swap', label: 'LAST WEAPON', group: 'COMBAT', def: 'KeyQ' },
  { id: 'scoreboard', label: 'SCOREBOARD', group: 'INTERFACE', def: 'Tab' },
  { id: 'leaderboard', label: 'LEADERBOARD', group: 'INTERFACE', def: 'KeyL' },
  { id: 'updates', label: 'UPDATES', group: 'INTERFACE', def: 'KeyU' },
  { id: 'skip', label: 'SKIP TUTORIAL STEP', group: 'INTERFACE', def: 'KeyN' },
  { id: 'mute', label: 'MUTE', group: 'INTERFACE', def: 'KeyM' },
  { id: 'pause', label: 'PAUSE', group: 'INTERFACE', def: 'Escape' },
];

const BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));

export const DEFAULT_BINDS = Object.fromEntries(ACTIONS.map((a) => [a.id, a.def]));

export function actionById(id) {
  return BY_ID.get(id) || null;
}

// Every physical key that triggers an action: the bound one plus any fixed
// alternatives (the arrow keys keep working for movement).
export function codesFor(action, binds = DEFAULT_BINDS) {
  const spec = BY_ID.get(action);
  const primary = binds[action] || spec?.def;
  const list = primary ? [primary] : [];
  for (const c of spec?.alt || []) if (!list.includes(c)) list.push(c);
  return list;
}

// Keys that a player should not be allowed to steal: the options panel needs
// Escape to get out, and digit keys select weapons.
export function reserved(code) {
  return code === 'Escape' || /^Digit[0-9]$/.test(code) || code === 'F5' || code === 'F12';
}

// Human-readable name for a KeyboardEvent.code.
export function keyLabel(code) {
  if (!code) return '—';
  const named = {
    Space: 'SPACE',
    ShiftLeft: 'L SHIFT',
    ShiftRight: 'R SHIFT',
    ControlLeft: 'L CTRL',
    ControlRight: 'R CTRL',
    AltLeft: 'L ALT',
    AltRight: 'R ALT',
    ArrowUp: 'UP',
    ArrowDown: 'DOWN',
    ArrowLeft: 'LEFT',
    ArrowRight: 'RIGHT',
    Tab: 'TAB',
    Escape: 'ESC',
    Backspace: 'BACKSPACE',
    CapsLock: 'CAPS',
    Enter: 'ENTER',
    NumpadAdd: 'NUM +',
    NumpadSubtract: 'NUM −',
    NumpadEnter: 'NUM ENTER',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backslash: '\\',
    BracketLeft: '[',
    BracketRight: ']',
    Minus: '-',
    Equal: '=',
    Backquote: '`',
  };
  if (named[code]) return named[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `NUM ${code.slice(6)}`;
  return code.toUpperCase();
}

// Assign `code` to `action`. If another action already owns that key the two
// swap, so no action is ever left unbound and no key is bound twice.
export function assign(binds, action, code) {
  const next = { ...binds };
  const previous = next[action];
  for (const id of Object.keys(next)) {
    if (id === action || next[id] !== code) continue;
    next[id] = previous && previous !== code ? previous : DEFAULT_BINDS[id];
  }
  next[action] = code;
  return dedupe(next);
}

// Last-resort guard: if a merge ever produces two actions on one key, the
// alphabetically-later one goes back to its default.
export function dedupe(binds) {
  const out = { ...binds };
  const seen = new Set();
  for (const a of ACTIONS) {
    if (!out[a.id]) continue;
    if (seen.has(out[a.id])) out[a.id] = DEFAULT_BINDS[a.id];
    seen.add(out[a.id]);
  }
  return out;
}

// Which action (other than `except`) currently owns `code`.
export function ownerOf(binds, code, except = null) {
  for (const a of ACTIONS) {
    if (a.id !== except && binds[a.id] === code) return a;
  }
  return null;
}

// Merge stored bindings over the defaults, ignoring unknown actions and
// obviously broken values.
export function normalise(raw) {
  const out = { ...DEFAULT_BINDS };
  if (!raw || typeof raw !== 'object') return out;
  for (const a of ACTIONS) {
    const v = raw[a.id];
    if (typeof v === 'string' && v.length >= 1 && v.length <= 24) out[a.id] = v;
  }
  return out;
}

export function conflicts(binds) {
  const seen = new Map();
  const dupes = [];
  for (const [id, code] of Object.entries(binds)) {
    if (seen.has(code)) dupes.push([seen.get(code), id, code]);
    else seen.set(code, id);
  }
  return dupes;
}

export { BY_ID };
