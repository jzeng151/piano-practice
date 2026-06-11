import { SplendidGrandPiano } from 'smplr';

// Voice model over an injected player so the bookkeeping is unit-testable:
// one voice per keydown instance; re-striking a sounding pitch stops the prior
// voice first; pedal-up flushes ALL deferred releases; polyphony cap with
// oldest-voice stealing; panic releases pedal first, then everything.

export interface NotePlayer {
  start(midi: number, velocity: number): () => void; // returns stop fn
}

export const POLYPHONY_CAP = 32;

interface Voice {
  id: number;
  midi: number;
  stop: () => void;
  deferred: boolean; // key released while pedal down — stop deferred
}

export class VoiceManager {
  private voices: Voice[] = [];
  private pedalDown = false;
  private nextId = 1;
  private player: NotePlayer;
  private cap: number;

  constructor(player: NotePlayer, cap = POLYPHONY_CAP) {
    this.player = player;
    this.cap = cap;
  }

  noteOn(midi: number, velocity: number): void {
    // re-strike: stop any still-sounding voice of this pitch
    for (const v of this.voices.filter((v) => v.midi === midi)) {
      v.stop();
    }
    this.voices = this.voices.filter((v) => v.midi !== midi);

    if (this.voices.length >= this.cap) {
      const oldest = this.voices.shift();
      oldest?.stop();
    }
    const stop = this.player.start(midi, velocity);
    this.voices.push({ id: this.nextId++, midi, stop, deferred: false });
  }

  noteOff(midi: number): void {
    for (const v of this.voices) {
      if (v.midi === midi && !v.deferred) {
        if (this.pedalDown) {
          v.deferred = true;
        } else {
          v.stop();
        }
      }
    }
    if (!this.pedalDown) {
      this.voices = this.voices.filter((v) => v.midi !== midi);
    }
  }

  pedal(down: boolean): void {
    this.pedalDown = down;
    if (!down) {
      for (const v of this.voices) {
        if (v.deferred) v.stop();
      }
      this.voices = this.voices.filter((v) => !v.deferred);
    }
  }

  /** Pedal flushed first, then every voice. */
  panic(): void {
    this.pedal(false);
    for (const v of this.voices) v.stop();
    this.voices = [];
  }

  get activeCount(): number {
    return this.voices.length;
  }
}

export interface PianoLoadProgress {
  loaded: number;
  total: number;
}

/**
 * Piano — smplr SplendidGrandPiano behind the VoiceManager, with a
 * WebAudio-oscillator count-in click (no extra sample assets).
 */
export class Piano {
  readonly context: AudioContext;
  private instrument: ReturnType<typeof SplendidGrandPiano>;
  readonly voices: VoiceManager;
  private loadPromise: Promise<void>;

  constructor(onProgress?: (p: PianoLoadProgress) => void) {
    this.context = new AudioContext({ latencyHint: 'interactive' });
    this.instrument = SplendidGrandPiano(this.context, {
      baseUrl: `${import.meta.env.BASE_URL}samples/splendid-grand-piano`,
      onLoadProgress: onProgress,
      // Sample names contain '#' (e.g. "PP D#0"), which static servers treat
      // as a fragment even when encoded. Files are vendored with '#' renamed
      // to '_sharp_' (scripts/fetch-samples.mjs); rewrite requests to match.
      storage: {
        fetch: (url: string) => fetch(url.replaceAll('%23', '_sharp_').replaceAll('#', '_sharp_')),
      },
    });
    this.loadPromise = this.instrument.load.then(() => undefined);
    this.voices = new VoiceManager({
      start: (midi, velocity) => this.instrument.start({ note: midi, velocity }),
    });
  }

  /** Resolves when all samples are decoded. */
  load(): Promise<void> {
    return this.loadPromise;
  }

  /** Must be called from a user gesture before first sound. */
  async resume(): Promise<void> {
    if (this.context.state !== 'running') {
      await this.context.resume().catch(() => undefined);
    }
  }

  /**
   * Belt-and-braces: noteOn/pedal run synchronously inside real keydown
   * handlers, which carry user activation — so a context that missed (or was
   * denied) its first resume() recovers on the very next keypress instead of
   * staying silent forever.
   */
  private ensureRunning(): void {
    if (this.context.state !== 'running') {
      void this.context.resume().catch(() => undefined);
    }
  }

  /** Subscribe to context running/suspended changes (for the UI banner). */
  onStateChange(listener: () => void): () => void {
    this.context.addEventListener('statechange', listener);
    return () => this.context.removeEventListener('statechange', listener);
  }

  isRunning(): boolean {
    return this.context.state === 'running';
  }

  noteOn(midi: number, velocity: number): void {
    this.ensureRunning();
    this.voices.noteOn(midi, velocity);
  }

  noteOff(midi: number): void {
    this.voices.noteOff(midi);
  }

  pedal(down: boolean): void {
    this.ensureRunning();
    this.voices.pedal(down);
  }

  panic(): void {
    this.voices.panic();
  }

  /** Short metronome click; accented for the first beat of the bar. */
  click(accent: boolean, when = 0): void {
    this.ensureRunning();
    const t = when > 0 ? when : this.context.currentTime;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.frequency.value = accent ? 1568 : 1047;
    gain.gain.setValueAtTime(0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    osc.connect(gain).connect(this.context.destination);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  latencyInfo(): { baseLatency: number; outputLatency: number | null } {
    return {
      baseLatency: this.context.baseLatency ?? 0,
      // Safari lacks outputLatency — report partial where unavailable.
      outputLatency:
        'outputLatency' in this.context ? (this.context as AudioContext).outputLatency : null,
    };
  }

  async dispose(): Promise<void> {
    this.panic();
    await this.context.close();
  }
}
