import { describe, expect, it } from 'vitest';
import {
  KeyboardInputSource,
  KEY_OFFSETS,
  DEFAULT_WINDOW_BASE,
  WINDOW_BASE_MIN,
  WINDOW_BASE_MAX_C,
  letterForOffset,
} from './keyboard';
import type { InputEvent } from './types';

function collect(src: KeyboardInputSource): InputEvent[] {
  const events: InputEvent[] = [];
  src.subscribe((e) => events.push(e));
  return events;
}

describe('key mapping', () => {
  it('covers every semitone 0..17 exactly once', () => {
    const offsets = Object.values(KEY_OFFSETS).sort((a, b) => a - b);
    expect(offsets).toEqual([...Array(18).keys()]);
  });

  it('maps home row to white keys from C and top row to black keys', () => {
    expect(KEY_OFFSETS['KeyA']).toBe(0); // C
    expect(KEY_OFFSETS['KeyW']).toBe(1); // C#
    expect(KEY_OFFSETS['Quote']).toBe(17); // F (next octave)
    expect(letterForOffset(0)).toBe('a');
    expect(letterForOffset(16)).toBe(';');
    expect(letterForOffset(17)).toBe("'");
  });

  it('emits note on/off with the window-based pitch', () => {
    const src = new KeyboardInputSource();
    const events = collect(src);
    src.handleKeyDown('KeyA', false, 1);
    src.handleKeyUp('KeyA', 2);
    expect(events).toEqual([
      { type: 'note', on: true, midi: DEFAULT_WINDOW_BASE, velocity: 96, timestamp: 1 },
      { type: 'note', on: false, midi: DEFAULT_WINDOW_BASE, velocity: 0, timestamp: 2 },
    ]);
  });

  it('ignores auto-repeat keydown', () => {
    const src = new KeyboardInputSource();
    const events = collect(src);
    src.handleKeyDown('KeyA', false, 1);
    src.handleKeyDown('KeyA', true, 2);
    src.handleKeyDown('KeyA', true, 3);
    expect(events.filter((e) => e.type === 'note' && e.on)).toHaveLength(1);
  });
});

describe('octave shift', () => {
  it('shifts by octaves and clamps at both ends', () => {
    const src = new KeyboardInputSource();
    for (let i = 0; i < 20; i++) src.handleKeyDown('KeyZ', false, i);
    expect(src.getWindowBase()).toBe(WINDOW_BASE_MIN);
    for (let i = 0; i < 20; i++) src.handleKeyDown('KeyX', false, i);
    expect(src.getWindowBase()).toBe(WINDOW_BASE_MAX_C);
  });

  it('releases the ORIGINALLY sounded pitch after a mid-hold shift', () => {
    const src = new KeyboardInputSource();
    const events = collect(src);
    src.handleKeyDown('KeyA', false, 1); // C4 = 60
    src.handleKeyDown('KeyZ', false, 2); // window down an octave
    src.handleKeyUp('KeyA', 3);
    const off = events.find((e) => e.type === 'note' && !e.on);
    expect(off).toMatchObject({ midi: DEFAULT_WINDOW_BASE });
  });
});

describe('pedal', () => {
  it('held mode: down on press, up on release', () => {
    const src = new KeyboardInputSource();
    const events = collect(src);
    src.handleKeyDown('Space', false, 1);
    src.handleKeyUp('Space', 2);
    expect(events).toEqual([
      { type: 'pedal', down: true, timestamp: 1 },
      { type: 'pedal', down: false, timestamp: 2 },
    ]);
  });

  it('latch mode: press toggles, release does nothing', () => {
    const src = new KeyboardInputSource({ pedalLatch: true });
    const events = collect(src);
    src.handleKeyDown('Space', false, 1);
    src.handleKeyUp('Space', 2);
    src.handleKeyDown('Space', false, 3);
    expect(events).toEqual([
      { type: 'pedal', down: true, timestamp: 1 },
      { type: 'pedal', down: false, timestamp: 3 },
    ]);
  });
});

describe('releaseAll (blur safety)', () => {
  it('flushes pedal FIRST, then releases every held note', () => {
    const src = new KeyboardInputSource();
    const events = collect(src);
    src.handleKeyDown('KeyA', false, 1);
    src.handleKeyDown('KeyD', false, 2);
    src.handleKeyDown('Space', false, 3);
    events.length = 0;
    src.releaseAll();
    expect(events[0]).toMatchObject({ type: 'pedal', down: false });
    const offs = events.filter((e) => e.type === 'note' && !e.on);
    expect(offs.map((e) => (e.type === 'note' ? e.midi : -1)).sort()).toEqual([60, 64]);
  });
});
