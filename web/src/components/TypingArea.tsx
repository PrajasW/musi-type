import { memo, useLayoutEffect, useRef } from 'react';
import { layoutLine, type TypingState } from '../lib/typing';

interface LineProps {
  index: number;
  text: string;
  typed: string;
  status: 'open' | 'done' | 'locked';
  isCurrent: boolean;
  isSung: boolean;
  register: (i: number, el: HTMLDivElement | null) => void;
  onClick: (i: number) => void;
}

const Line = memo(function Line({ index, text, typed, status, isCurrent, isSung, register, onClick }: LineProps) {
  const closed = status !== 'open';
  const cls = ['line', isCurrent && 'current', closed && 'closed', isSung && 'sung', status === 'locked' && 'locked']
    .filter(Boolean)
    .join(' ');
  return (
    <div ref={(el) => register(index, el)} className={cls} onClick={() => onClick(index)}>
      {layoutLine(text, typed, closed).cells.map((cell, i) => (
        <span key={i} className={cell.state}>
          {cell.ch || '​'}
        </span>
      ))}
    </div>
  );
});

/** How many not-yet-revealed lines are shown faded, so you can see what's coming. */
const PREVIEW_LINES = 1;

interface Props {
  texts: string[];
  state: TypingState;
  /** index of the line currently being sung, or -1 when not syncing */
  sungIdx: number;
  /** how many lines have been revealed so far; later lines are hidden */
  visible: number;
  /** fraction (0..1) of the current line's time already used, or null */
  deadline: number | null;
  onLineClick: (i: number) => void;
}

export function TypingArea({ texts, state, sungIdx, visible, deadline, onLineClick }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLSpanElement>(null);
  const lineEls = useRef<(HTMLDivElement | null)[]>([]);
  const register = useRef((i: number, el: HTMLDivElement | null) => {
    lineEls.current[i] = el;
  }).current;

  const curTyped = state.typed[state.cur] ?? '';

  useLayoutEffect(() => {
    const list = listRef.current;
    const caret = caretRef.current;
    if (!list || !caret) return;
    // keep the line above the current one visible, like Monkeytype's 3-line window
    const anchor = lineEls.current[Math.max(0, Math.min(state.cur - 1, visible - 1))] ?? lineEls.current[0];
    list.style.transform = `translateY(${-(anchor?.offsetTop ?? 0)}px)`;

    const line = lineEls.current[state.cur];
    // the caret sits before the next letter; extra letters push it right, past the word's end
    const caretAt = layoutLine(texts[state.cur] ?? '', curTyped, false).caret;
    const ch = line?.children[caretAt] as HTMLElement | undefined;
    if (!line || !ch || state.done) {
      caret.style.opacity = '0';
      return;
    }
    caret.style.opacity = '1';
    caret.style.height = `${ch.offsetHeight}px`;
    caret.style.transform = `translate(${line.offsetLeft + ch.offsetLeft}px, ${line.offsetTop + ch.offsetTop}px)`;
  });

  return (
    <div className="typing-wrap">
      {deadline !== null && (
        <div className="deadline" aria-hidden>
          <div style={{ width: `${Math.max(0, 1 - deadline) * 100}%` }} />
        </div>
      )}
      <div className="typing-viewport">
        <div className="typing-list" ref={listRef}>
          <span className="caret" ref={caretRef} />
          {texts.slice(0, visible).map((text, i) => (
            <Line
              key={i}
              index={i}
              text={text}
              typed={state.typed[i]}
              status={state.status[i]}
              isCurrent={i === state.cur && !state.done}
              isSung={i === sungIdx}
              register={register}
              onClick={onLineClick}
            />
          ))}
          {!state.done &&
            texts.slice(visible, visible + PREVIEW_LINES).map((text, i) => (
              <div key={visible + i} className="line upcoming" aria-hidden>
                {text}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
