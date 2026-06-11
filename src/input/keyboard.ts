import type { InputEvent, InputSource } from './types';

// Physical-position mapping (KeyboardEvent.code, US-physical layout assumed).
// Home row = white keys from the window's base C; top row = the black keys
// between them. Together they cover every semitone in [base, base+17].
export const KEY_OFFSETS: Record<string, number> = {
  KeyA: 0, // C
  KeyW: 1, // C#
  KeyS: 2, // D
  KeyE: 3, // D#
  KeyD: 4, // E
  KeyF: 5, // F
  KeyT: 6, // F#
  KeyG: 7, // G
  KeyY: 8, // G#
  KeyH: 9, // A
  KeyU: 10, // A#
  KeyJ: 11, // B
  KeyK: 12, // C
  KeyO: 13, // C#
  KeyL: 14, // D
  KeyP: 15, // D#
  Semicolon: 16, // E
  Quote: 17, // F
};

export const WINDOW_SPAN = 18; // semitones covered by the mapping
export const DEFAULT_WINDOW_BASE = 60; // C4
const MIDI_MIN = 21;
const MIDI_MAX = 108;
// Window base must keep every mapped note inside [MIDI_MIN, MIDI_MAX]:
// lowest C ≥ 21 is 24 (C1); highest C with base+17 ≤ 108 is 84 (C6).
export const WINDOW_BASE_MIN = MIDI_MIN + 3; // 24
export const WINDOW_BASE_MAX_C = MIDI_MAX - 24; // 84

export const OCTAVE_DOWN_CODE = 'KeyZ';
export const OCTAVE_UP_CODE = 'KeyX';
export const PEDAL_CODE = 'Space';

export function clampWindowBase(base: number): number {
  return Math.min(WINDOW_BASE_MAX_C, Math.max(WINDOW_BASE_MIN, base));
}

export interface KeyboardInputOptions {
  /** Pedal acts as a toggle instead of held. */
  pedalLatch?: boolean;
  /** Initial window base (a C). Defaults to C4 (60). */
  windowBase?: number;
  onWindowBaseChange?: (base: number) => void;
}

/**
 * KeyboardInputSource — owns the code→MIDI mapping, octave shifting, pedal
 * handling, and blur safety. Each keydown records code→soundedMidi so a
 * release always stops the pitch that actually sounded, even if the octave
 * window shifted while the key was held.
 */
export class KeyboardInputSource implements InputSource {
  private listeners = new Set<(e: InputEvent) => void>();
  private sounded = new Map<string, number>(); // code → midi at press time
  private pedalDown = false;
  private pedalLatch: boolean;
  private windowBase: number;
  private attached = false;
  private onWindowBaseChange?: (base: number) => void;

  constructor(opts: KeyboardInputOptions = {}) {
    this.pedalLatch = opts.pedalLatch ?? false;
    this.windowBase = clampWindowBase(opts.windowBase ?? DEFAULT_WINDOW_BASE);
    this.onWindowBaseChange = opts.onWindowBaseChange;
  }

  subscribe(listener: (e: InputEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.releaseAll);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  detach(): void {
    if (!this.attached) return;
    this.releaseAll();
    this.attached = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.releaseAll);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  getWindowBase(): number {
    return this.windowBase;
  }

  setWindowBase(base: number): void {
    const next = clampWindowBase(base);
    if (next !== this.windowBase) {
      this.windowBase = next;
      this.onWindowBaseChange?.(next);
    }
  }

  setPedalLatch(latch: boolean): void {
    this.pedalLatch = latch;
  }

  isPedalDown(): boolean {
    return this.pedalDown;
  }

  /** Test hook + reuse for synthetic events. */
  handleKeyDown(code: string, repeat: boolean, timestamp: number): boolean {
    if (repeat) return code in KEY_OFFSETS || code === PEDAL_CODE;
    if (code === OCTAVE_DOWN_CODE) {
      this.setWindowBase(this.windowBase - 12);
      return true;
    }
    if (code === OCTAVE_UP_CODE) {
      this.setWindowBase(this.windowBase + 12);
      return true;
    }
    if (code === PEDAL_CODE) {
      if (this.pedalLatch) {
        this.setPedal(!this.pedalDown, timestamp);
      } else if (!this.pedalDown) {
        this.setPedal(true, timestamp);
      }
      return true;
    }
    const offset = KEY_OFFSETS[code];
    if (offset === undefined) return false;
    if (this.sounded.has(code)) return true; // already down (safety)
    const midi = this.windowBase + offset;
    this.sounded.set(code, midi);
    this.emit({ type: 'note', on: true, midi, velocity: 96, timestamp });
    return true;
  }

  handleKeyUp(code: string, timestamp: number): boolean {
    if (code === PEDAL_CODE) {
      if (!this.pedalLatch && this.pedalDown) this.setPedal(false, timestamp);
      return true;
    }
    const midi = this.sounded.get(code);
    if (midi === undefined) return code in KEY_OFFSETS;
    this.sounded.delete(code);
    this.emit({ type: 'note', on: false, midi, velocity: 0, timestamp });
    return true;
  }

  /** Pedal flushed FIRST so deferred releases stop; then every held key. */
  releaseAll = (): void => {
    const t = performance.now();
    if (this.pedalDown) this.setPedal(false, t);
    for (const [code, midi] of this.sounded) {
      this.sounded.delete(code);
      this.emit({ type: 'note', on: false, midi, velocity: 0, timestamp: t });
    }
  };

  private onVisibility = (): void => {
    if (document.visibilityState === 'hidden') this.releaseAll();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.handleKeyDown(e.code, e.repeat, e.timeStamp)) e.preventDefault();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (this.handleKeyUp(e.code, e.timeStamp)) e.preventDefault();
  };

  private setPedal(down: boolean, timestamp: number): void {
    this.pedalDown = down;
    this.emit({ type: 'pedal', down, timestamp });
  }

  private emit(e: InputEvent): void {
    for (const l of this.listeners) l(e);
  }
}

/** Letter shown on lane notes / on-screen keys for a window offset. */
export function letterForOffset(offset: number): string {
  const entry = Object.entries(KEY_OFFSETS).find(([, o]) => o === offset);
  if (!entry) return '';
  const code = entry[0];
  if (code === 'Semicolon') return ';';
  if (code === 'Quote') return "'";
  return code.replace('Key', '').toLowerCase();
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiToName(midi: number): string {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}
