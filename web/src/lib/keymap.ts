/** US QWERTY layout for the on-screen keyboard. Widths are in key units. */
export interface KeyDef {
  id: string;
  label: string;
  w: number;
}

const k = (id: string, label = id.toUpperCase(), w = 1): KeyDef => ({ id, label, w });

export const ROWS: KeyDef[][] = [
  [
    ...['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='].map((c) => k(c, c)),
    k('backspace', '⌫', 2),
  ],
  [k('tab', 'tab', 1.5), ...'qwertyuiop'.split('').map((c) => k(c)), k('[', '[', 1), k(']', ']', 1), k('\\', '\\', 1.5)],
  [k('caps', 'caps', 1.75), ...'asdfghjkl'.split('').map((c) => k(c)), k(';', ';'), k("'", "'"), k('enter', '⏎', 2.25)],
  [k('shift-l', 'shift', 2.25), ...'zxcvbnm'.split('').map((c) => k(c)), k(',', ','), k('.', '.'), k('/', '/'), k('shift-r', 'shift', 2.75)],
  [k('space', '', 6.25)],
];

const SHIFTED: Record<string, string> = {
  '~': '`', '!': '1', '@': '2', '#': '3', $: '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0',
  _: '-', '+': '=', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/',
};
const PLAIN = new Set(['`', '-', '=', '[', ']', '\\', ';', "'", ',', '.', '/']);

/** The physical key that types `ch`, and whether Shift is needed. null for characters with no key here. */
export function charToKey(ch: string): { id: string; shift: boolean } | null {
  if (ch === ' ') return { id: 'space', shift: false };
  if (/^[a-z0-9]$/.test(ch) || PLAIN.has(ch)) return { id: ch, shift: false };
  if (/^[A-Z]$/.test(ch)) return { id: ch.toLowerCase(), shift: true };
  if (ch in SHIFTED) return { id: SHIFTED[ch], shift: true };
  return null;
}

/** Keys to outline as "next": the character's key (plus both Shifts if needed). */
export function nextKeyIds(next: string | 'backspace' | null): Set<string> {
  const ids = new Set<string>();
  if (next === null) return ids;
  if (next === 'backspace') return ids.add('backspace');
  const key = charToKey(next);
  if (!key) return ids;
  ids.add(key.id);
  if (key.shift) ids.add('shift-l').add('shift-r');
  return ids;
}
