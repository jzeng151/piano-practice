import type { CompiledSong, NoteGroup } from '../songs/types';
import type { InputEvent } from '../input/types';
import { Scorer, type ScoreCounts, type Judgment } from './scorer';
import { handMatches } from './scorer';

export type GuideMode = 'wait' | 'scroll';
export type HandFilter = 'L' | 'R' | 'both';
export type FsmState = 'idle' | 'playing' | 'waiting' | 'paused' | 'finished';

export const LEAD_IN_REAL_SEC = 2;

export interface EngineAudio {
  noteOn(midi: number, velocity: number): void;
  noteOff(midi: number): void;
  pedal(down: boolean): void;
  click(accent: boolean): void;
  panic(): void;
}

export interface EngineOptions {
  compiled: CompiledSong;
  mode: GuideMode;
  speed: number; // 0.5 | 0.75 | 1
  hands: HandFilter;
  countIn: boolean; // audible click during lead-in (scroll mode)
  audio: EngineAudio;
}

export interface WrongFlash {
  midi: number;
  atReal: number; // performance.now() ms
}

export interface EngineSnapshot {
  state: FsmState;
  songTime: number;
  durationSec: number;
  mode: GuideMode;
  speed: number;
  hands: HandFilter;
  /** index of the group currently gating (wait mode), else -1 */
  gatingGroup: number;
  /** pitches of the gating group already satisfied */
  satisfied: ReadonlySet<number>;
  counts: ScoreCounts;
  accuracy: number;
  wrongFlashes: readonly WrongFlash[];
  judgments: ReadonlyMap<number, Judgment>;
  loopA: number | null;
  loopB: number | null;
  wrongPresses: number;
  elapsedRealSec: number;
  sounding: readonly number[];
}

/**
 * The practice engine: delta-accumulating transport + FSM + wait-gate v2 +
 * scroll scorer + A-B loop + per-hand auto-play + count-in. No React, no DOM
 * rendering — the canvas renderer reads snapshots, React subscribes via
 * useSyncExternalStore.
 *
 *   idle → playing ⇄ waiting → finished
 *                 ⇅
 *               paused (from playing or waiting)
 *
 * Transport: songTime advances only in `playing`, by performance.now() deltas
 * scaled by speed. It freezes in waiting/paused — immune to rAF throttling,
 * unbounded gates, and wall-clock drift.
 */
export class Engine {
  private compiled: CompiledSong;
  private mode: GuideMode;
  private speed: number;
  private hands: HandFilter;
  private countIn: boolean;
  private audio: EngineAudio;

  private state: FsmState = 'idle';
  private songTime = 0; // starts at -leadInSong
  private lastNow: number | null = null;
  private elapsedRealMs = 0;

  // wait mode
  private gatingGroup = -1; // index into gateGroups
  private gateGroups: { groupIndex: number; group: NoteGroup; required: number[] }[] = [];
  private struckSinceArm = new Set<number>();
  private sounding = new Set<number>(); // held keys (by pitch)
  private pedalSustained = new Set<number>(); // struck-while-pedal pitches still ringing
  private pedalDown = false;
  private satisfied = new Set<number>();
  private nextGate = 0;

  // per-hand auto-play
  private autoplayed = new Set<string>(); // `${groupIndex}:${midi}`

  // scroll scoring
  private scorer: Scorer;
  private wrongPresses = 0;
  private wrongFlashes: WrongFlash[] = [];

  // count-in clicks (real-time offsets from start, ms)
  private pendingClicks: { atRealMs: number; accent: boolean }[] = [];
  private startRealMs = 0;

  // A-B loop
  private loopA: number | null = null;
  private loopB: number | null = null;

  private version = 0;
  private listeners = new Set<() => void>();
  private snapshot: EngineSnapshot;

  constructor(opts: EngineOptions) {
    this.compiled = opts.compiled;
    this.mode = opts.mode;
    this.speed = opts.speed;
    this.hands = opts.hands;
    this.countIn = opts.countIn;
    this.audio = opts.audio;

    // Gate groups: groups containing at least one note the USER plays.
    this.compiled.groups.forEach((group, groupIndex) => {
      const required = group.notes
        .filter((n) => handMatches(n.hand, this.hands))
        .map((n) => n.midi);
      if (required.length > 0) {
        this.gateGroups.push({ groupIndex, group, required: [...new Set(required)] });
      }
    });

    this.scorer = new Scorer(this.compiled, this.hands, this.speed);
    this.snapshot = this.buildSnapshot();
  }

  /** Total real seconds of lead-in, extended to fit a 4-beat count-in. */
  private leadInRealSec(): number {
    if (this.mode !== 'scroll' || !this.countIn) return LEAD_IN_REAL_SEC;
    const bpm = this.compiled.song.tempoMap[0]?.bpm ?? 120;
    const beatReal = 60 / bpm / this.speed;
    return Math.max(LEAD_IN_REAL_SEC, 4 * beatReal);
  }

  start(): void {
    if (this.state !== 'idle') return;
    const leadReal = this.leadInRealSec();
    this.songTime = -leadReal * this.speed;
    this.startRealMs = performance.now();
    this.lastNow = null;
    if (this.mode === 'scroll' && this.countIn) {
      const bpm = this.compiled.song.tempoMap[0]?.bpm ?? 120;
      const beatRealMs = (60 / bpm / this.speed) * 1000;
      for (let i = 0; i < 4; i++) {
        this.pendingClicks.push({
          atRealMs: (leadReal * 1000) - (4 - i) * beatRealMs,
          accent: i === 0,
        });
      }
    }
    this.setState('playing');
  }

  pause(): void {
    if (this.state === 'playing' || this.state === 'waiting') {
      this.setState('paused');
      this.lastNow = null;
    }
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.lastNow = null;
    // Re-enter waiting if a gate was active, else playing.
    this.setState(this.gatingGroup >= 0 ? 'waiting' : 'playing');
  }

  setLoop(a: number | null, b: number | null): void {
    if (a !== null && b !== null && b <= a) [a, b] = [b, a];
    this.loopA = a;
    this.loopB = b;
    this.bump();
  }

  /** Main loop driver — call once per rAF with performance.now(). */
  tick(now: number): void {
    if (this.state === 'playing') {
      if (this.lastNow !== null) {
        const dt = (now - this.lastNow) / 1000;
        this.songTime += dt * this.speed;
        this.elapsedRealMs += now - this.lastNow;
      }
      this.lastNow = now;

      // count-in clicks
      while (this.pendingClicks.length > 0 && now - this.startRealMs >= this.pendingClicks[0].atRealMs) {
        const c = this.pendingClicks.shift()!;
        this.audio.click(c.accent);
      }

      this.runAutoplay();

      if (this.mode === 'wait') {
        const next = this.gateGroups[this.nextGate];
        if (next && this.songTime >= next.group.startSec) {
          this.songTime = next.group.startSec; // clamp at the gate
          this.armGate(this.nextGate);
          this.setState('waiting');
        } else if (!next && this.songTime >= this.compiled.durationSec) {
          this.finish();
        }
      } else {
        this.scorer.advance(this.songTime);
        if (this.songTime >= this.compiled.durationSec && this.scorer.done(this.songTime)) {
          this.finish();
        }
      }

      // A-B loop wrap
      if (this.loopA !== null && this.loopB !== null && this.songTime >= this.loopB) {
        this.jumpTo(this.loopA);
      }

      this.bump();
    } else if (this.state === 'waiting') {
      if (this.lastNow !== null) this.elapsedRealMs += now - this.lastNow;
      this.lastNow = now;
    } else {
      this.lastNow = null;
    }
  }

  /** Feed every input event here (audio is handled by the caller, not the FSM). */
  handleInput(e: InputEvent): void {
    if (e.type === 'pedal') {
      this.pedalDown = e.down;
      if (e.down) {
        // the damper catches notes already sounding
        for (const m of this.sounding) this.pedalSustained.add(m);
      } else {
        this.pedalSustained.clear();
        if (this.state === 'waiting') this.evaluateGate(null);
      }
      return;
    }
    if (e.on) {
      this.sounding.add(e.midi);
      if (this.pedalDown) this.pedalSustained.add(e.midi);

      if (this.state === 'waiting') {
        this.struckSinceArm.add(e.midi);
        this.evaluateGate(e.midi);
      } else if (this.state === 'playing' && this.mode === 'scroll' && this.songTime >= 0) {
        const judgment = this.scorer.press(e.midi, this.songTime);
        if (judgment === 'wrong') {
          this.wrongPresses++;
          this.pushWrongFlash(e.midi);
        }
        this.bump();
      } else if (this.state === 'playing' && this.mode === 'wait') {
        // pressed between gates — free play, marked as wrong only visually
        this.wrongPresses++;
        this.pushWrongFlash(e.midi);
        this.bump();
      }
    } else {
      this.sounding.delete(e.midi);
      if (this.state === 'waiting') this.evaluateGate(null);
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): EngineSnapshot => this.snapshot;

  destroy(): void {
    this.audio.panic();
    this.listeners.clear();
  }

  // --- internals ---

  private armGate(gateIndex: number): void {
    this.gatingGroup = gateIndex;
    this.struckSinceArm.clear();
    this.satisfied.clear();
  }

  /**
   * Wait-gate v2: every required pitch needs a FRESH keydown since the group
   * armed, and that strike must still be sounding (held or pedal-sustained).
   * Wrong pitches never block; they're marked visually by the caller path.
   */
  private evaluateGate(pressedMidi: number | null): void {
    const gate = this.gateGroups[this.gatingGroup];
    if (!gate) return;

    if (pressedMidi !== null && !gate.required.includes(pressedMidi)) {
      this.wrongPresses++;
      this.pushWrongFlash(pressedMidi);
    }

    this.satisfied = new Set(
      gate.required.filter(
        (m) =>
          this.struckSinceArm.has(m) && (this.sounding.has(m) || this.pedalSustained.has(m)),
      ),
    );

    if (this.satisfied.size === gate.required.length) {
      // gate opens: auto-play the muted-hand notes of this group
      for (const n of gate.group.notes) {
        if (!handMatches(n.hand, this.hands)) {
          this.audio.noteOn(n.midi, n.velocity);
          this.autoplayed.add(`${gate.groupIndex}:${n.midi}`);
        }
      }
      this.gatingGroup = -1;
      this.nextGate++;
      if (this.nextGate >= this.gateGroups.length && this.songTime >= this.compiled.durationSec) {
        this.finish();
      } else {
        this.setState('playing');
      }
    }
    this.bump();
  }

  /** Auto-play notes of the muted hand as song time passes them. */
  private runAutoplay(): void {
    if (this.hands === 'both') return;
    this.compiled.groups.forEach((group, groupIndex) => {
      if (group.startSec > this.songTime) return;
      for (const n of group.notes) {
        if (handMatches(n.hand, this.hands)) continue;
        const key = `${groupIndex}:${n.midi}`;
        if (this.autoplayed.has(key)) continue;
        // In wait mode, muted notes in GATE groups fire when the gate opens.
        if (this.mode === 'wait' && this.gateGroups.some((g) => g.groupIndex === groupIndex)) continue;
        this.autoplayed.add(key);
        this.audio.noteOn(n.midi, n.velocity);
      }
    });
  }

  private jumpTo(songTime: number): void {
    this.songTime = songTime;
    if (this.mode === 'scroll') {
      this.scorer.resetWindow(songTime, this.loopB ?? Infinity);
    } else {
      this.nextGate = this.gateGroups.findIndex((g) => g.group.startSec >= songTime);
      if (this.nextGate === -1) this.nextGate = this.gateGroups.length;
      this.gatingGroup = -1;
      if (this.state === 'waiting') this.setState('playing');
    }
    // allow muted-hand notes to replay inside the loop window
    this.compiled.groups.forEach((group, groupIndex) => {
      if (group.startSec >= songTime) {
        for (const n of group.notes) this.autoplayed.delete(`${groupIndex}:${n.midi}`);
      }
    });
  }

  private finish(): void {
    this.audio.pedal(false);
    this.setState('finished');
  }

  private pushWrongFlash(midi: number): void {
    const now = performance.now();
    this.wrongFlashes = [...this.wrongFlashes.filter((f) => now - f.atReal < 400), { midi, atReal: now }];
  }

  private setState(s: FsmState): void {
    this.state = s;
    this.bump();
  }

  private bump(): void {
    this.version++;
    this.snapshot = this.buildSnapshot();
    for (const l of this.listeners) l();
  }

  private buildSnapshot(): EngineSnapshot {
    return {
      state: this.state,
      songTime: this.songTime,
      durationSec: this.compiled.durationSec,
      mode: this.mode,
      speed: this.speed,
      hands: this.hands,
      gatingGroup: this.gatingGroup >= 0 ? this.gateGroups[this.gatingGroup].groupIndex : -1,
      satisfied: new Set(this.satisfied),
      counts: this.scorer.getCounts(),
      accuracy: this.scorer.accuracy(),
      wrongFlashes: this.wrongFlashes,
      judgments: this.scorer.judgments,
      loopA: this.loopA,
      loopB: this.loopB,
      wrongPresses: this.wrongPresses,
      elapsedRealSec: this.elapsedRealMs / 1000,
      sounding: [...this.sounding],
    };
  }
}
