import { describe, expect, it } from 'vitest';
import { charToKey, nextKeyIds, ROWS } from './keymap';

describe('charToKey', () => {
  it('maps letters, digits, space and plain punctuation to their own key', () => {
    expect(charToKey('a')).toEqual({ id: 'a', shift: false });
    expect(charToKey('7')).toEqual({ id: '7', shift: false });
    expect(charToKey(' ')).toEqual({ id: 'space', shift: false });
    expect(charToKey("'")).toEqual({ id: "'", shift: false });
    expect(charToKey(',')).toEqual({ id: ',', shift: false });
  });

  it('needs Shift for capitals and shifted symbols', () => {
    expect(charToKey('Q')).toEqual({ id: 'q', shift: true });
    expect(charToKey('!')).toEqual({ id: '1', shift: true });
    expect(charToKey('?')).toEqual({ id: '/', shift: true });
    expect(charToKey('"')).toEqual({ id: "'", shift: true });
  });

  it('returns null for characters this layout has no key for', () => {
    expect(charToKey('é')).toBeNull();
    expect(charToKey('♪')).toBeNull();
  });
});

describe('nextKeyIds', () => {
  it('outlines the key, plus both Shifts when needed', () => {
    expect([...nextKeyIds('a')]).toEqual(['a']);
    expect([...nextKeyIds('A')].sort()).toEqual(['a', 'shift-l', 'shift-r']);
  });
  it('points at backspace when there is a mistake to fix, and at nothing when idle', () => {
    expect([...nextKeyIds('backspace')]).toEqual(['backspace']);
    expect(nextKeyIds(null).size).toBe(0);
    expect(nextKeyIds('é').size).toBe(0);
  });
});

describe('ROWS', () => {
  it('has rows that line up (15 units wide, apart from the space bar)', () => {
    for (const row of ROWS.slice(0, 4)) expect(row.reduce((a, key) => a + key.w, 0)).toBe(15);
  });
  it('has a unique id on every key', () => {
    const ids = ROWS.flat().map((key) => key.id).filter((id) => id !== 'shift-l' && id !== 'shift-r');
    expect(new Set(ids).size).toBe(ids.length);
  });
});
