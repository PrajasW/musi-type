import { memo, useEffect, useState } from 'react';
import { nextKeyIds, ROWS } from '../lib/keymap';

export interface KeyFlash {
  /** physical key ids that were pressed (e.g. "a", "backspace", or "shift-l" + "1" for "!") */
  ids: string[];
  ok: boolean;
  /** changes on every press so the same key can flash twice in a row */
  n: number;
}

interface Props {
  /** the character expected next, or "backspace" when the line has a mistake to fix */
  next: string | 'backspace' | null;
  flash: KeyFlash | null;
}

const FLASH_MS = 200;

/** Keymap mode: an on-screen keyboard that lights up as you type, like Monkeytype's. */
export const Keyboard = memo(function Keyboard({ next, flash }: Props) {
  const [lit, setLit] = useState<{ ids: Set<string>; ok: boolean } | null>(null);

  useEffect(() => {
    if (!flash) return;
    setLit({ ids: new Set(flash.ids), ok: flash.ok });
    const t = setTimeout(() => setLit(null), FLASH_MS);
    return () => clearTimeout(t);
  }, [flash]);

  const hint = nextKeyIds(next);

  return (
    <div className="keymap" aria-hidden>
      {ROWS.map((row, r) => (
        <div className="kb-row" key={r}>
          {row.map((key) => {
            const cls = ['kb-key', hint.has(key.id) && 'next', lit?.ids.has(key.id) && (lit.ok ? 'ok' : 'bad')]
              .filter(Boolean)
              .join(' ');
            return (
              <div key={key.id} className={cls} style={{ ['--w' as string]: key.w }} data-key={key.id}>
                {key.label}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
});
