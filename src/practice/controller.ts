import { Engine, type EngineOptions, type EngineSnapshot, type GuideMode, type HandFilter } from '../engine/clock';
import { KeyboardInputSource } from '../input/keyboard';
import { LaneRenderer } from '../render/lane';
import { Piano } from '../audio/piano';
import type { CompiledSong } from '../songs/types';
import { DEFAULT_WINDOW_BASE } from '../input/keyboard';

let sharedPiano: Piano | null = null;
let pianoProgress: { loaded: number; total: number } = { loaded: 0, total: 0 };
const progressListeners = new Set<() => void>();

/** Module-level piano: one AudioContext + one sample decode per session. */
export function getPiano(): Piano {
  if (!sharedPiano) {
    sharedPiano = new Piano((p) => {
      pianoProgress = p;
      for (const l of progressListeners) l();
    });
  }
  return sharedPiano;
}

export function subscribePianoProgress(l: () => void): () => void {
  progressListeners.add(l);
  return () => progressListeners.delete(l);
}

export function getPianoProgress(): { loaded: number; total: number } {
  return pianoProgress;
}

export interface PracticeConfig {
  mode: GuideMode;
  speed: number;
  hands: HandFilter;
  countIn: boolean;
  pedalLatch: boolean;
}

/**
 * Wires input → (audio, engine), owns the rAF loop and renderer. Setup is
 * idempotent and teardown total — StrictMode double-mount safe.
 */
export class PracticeController {
  readonly engine: Engine;
  readonly input: KeyboardInputSource;
  private renderer: LaneRenderer | null = null;
  private raf = 0;
  private unsubInput: (() => void) | null = null;
  private attached = false;
  readonly songWindowBase: number;
  /** capture: audio + engine receive input (popover preview / playing / waiting) */
  captureEnabled = true;

  compiled: CompiledSong;
  config: PracticeConfig;
  private piano: Piano;

  constructor(compiled: CompiledSong, config: PracticeConfig, piano: Piano) {
    this.compiled = compiled;
    this.config = config;
    this.piano = piano;
    this.songWindowBase = DEFAULT_WINDOW_BASE + compiled.song.baseWindowOffset;
    this.input = new KeyboardInputSource({
      pedalLatch: config.pedalLatch,
      windowBase: this.songWindowBase,
    });
    const engineOpts: EngineOptions = {
      compiled,
      mode: config.mode,
      speed: config.speed,
      hands: config.hands,
      countIn: config.countIn,
      audio: {
        noteOn: (m, v) => this.piano.noteOn(m, v),
        noteOff: (m) => this.piano.noteOff(m),
        pedal: (d) => this.piano.pedal(d),
        click: (a) => this.piano.click(a),
        panic: () => this.piano.panic(),
      },
    };
    this.engine = new Engine(engineOpts);
  }

  attach(canvas: HTMLCanvasElement): void {
    if (this.attached) return;
    this.attached = true;
    this.renderer = new LaneRenderer(canvas);
    this.unsubInput = this.input.subscribe((e) => {
      if (!this.captureEnabled) return;
      // Audio first (latency-critical), engine second; never via the FSM.
      if (e.type === 'note') {
        if (e.on) this.piano.noteOn(e.midi, e.velocity);
        else this.piano.noteOff(e.midi);
      } else {
        this.piano.pedal(e.down);
      }
      this.engine.handleInput(e);
    });
    this.input.attach();
    const loop = (now: number) => {
      this.engine.tick(now);
      const snap = this.engine.getSnapshot();
      this.renderer?.draw(snap, this.compiled, this.songWindowBase);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    cancelAnimationFrame(this.raf);
    this.unsubInput?.();
    this.input.detach();
    this.renderer?.destroy();
    this.renderer = null;
    this.piano.panic();
    this.engine.destroy();
  }

  async start(): Promise<void> {
    await this.piano.resume();
    this.engine.start();
  }

  pause(): void {
    this.engine.pause();
    this.input.releaseAll();
    this.captureEnabled = false;
  }

  resume(): void {
    this.captureEnabled = true;
    this.engine.resume();
  }

  setLoopMarker(which: 'A' | 'B'): void {
    const snap = this.engine.getSnapshot();
    if (which === 'A') this.engine.setLoop(Math.max(0, snap.songTime), snap.loopB);
    else this.engine.setLoop(snap.loopA, Math.max(0, snap.songTime));
  }

  clearLoop(): void {
    this.engine.setLoop(null, null);
  }

  getSnapshot = (): EngineSnapshot => this.engine.getSnapshot();
  subscribe = (l: () => void): (() => void) => this.engine.subscribe(l);
}
