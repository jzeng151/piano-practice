import type { CompiledSong, Hand } from '../songs/types';

export const SCORE_WINDOW_REAL_SEC = 0.15; // ±150 ms in REAL time

export type Judgment = 'hit' | 'early' | 'late' | 'miss';

export interface ScoreCounts {
  hit: number;
  early: number;
  late: number;
  miss: number;
  wrong: number;
  total: number;
}

interface Target {
  index: number;
  startSec: number; // song time
  midi: number;
  consumed: boolean;
  missed: boolean;
}

/**
 * Scroll-mode scorer. Window is real time (models motor accuracy — does not
 * scale with playback speed). Greedy nearest-unconsumed matching: one press
 * consumes at most one note; one note is consumed by at most one press.
 * Only fresh presses count — held keys never consume later notes.
 */
export class Scorer {
  private targets: Target[] = [];
  private counts: ScoreCounts = { hit: 0, early: 0, late: 0, miss: 0, wrong: 0, total: 0 };
  /** judgment per target index, for lane rendering */
  readonly judgments = new Map<number, Judgment>();

  private speed: number;

  constructor(compiled: CompiledSong, hands: 'L' | 'R' | 'both', speed: number) {
    this.speed = speed;
    let i = 0;
    for (const g of compiled.groups) {
      for (const n of g.notes) {
        if (hands === 'both' || n.hand === hands || n.hand === 'unknown') {
          this.targets.push({ index: i, startSec: g.startSec, midi: n.midi, consumed: false, missed: false });
        }
        i++;
      }
    }
    this.counts.total = this.targets.length;
  }

  private windowSongSec(): number {
    return SCORE_WINDOW_REAL_SEC * this.speed;
  }

  /** Call on every fresh noteOn. Returns the judgment (or 'wrong'). */
  press(midi: number, songTime: number): Judgment | 'wrong' {
    const w = this.windowSongSec();
    let best: Target | null = null;
    let bestDist = Infinity;
    for (const t of this.targets) {
      if (t.consumed || t.missed || t.midi !== midi) continue;
      const dist = Math.abs(t.startSec - songTime);
      if (dist <= w && dist < bestDist) {
        best = t;
        bestDist = dist;
      }
    }
    if (!best) {
      this.counts.wrong++;
      return 'wrong';
    }
    best.consumed = true;
    const deltaReal = (songTime - best.startSec) / this.speed;
    const judgment: Judgment =
      Math.abs(deltaReal) <= 0.05 ? 'hit' : deltaReal < 0 ? 'early' : 'late';
    this.counts[judgment]++;
    this.judgments.set(best.index, judgment);
    return judgment;
  }

  /** Advance: mark unconsumed targets whose window has closed as missed. */
  advance(songTime: number): void {
    const w = this.windowSongSec();
    for (const t of this.targets) {
      if (!t.consumed && !t.missed && songTime - t.startSec > w) {
        t.missed = true;
        this.counts.miss++;
        this.judgments.set(t.index, 'miss');
      }
    }
  }

  /** Reset targets inside [aSec, bSec) for A-B looping. */
  resetWindow(aSec: number, bSec: number): void {
    for (const t of this.targets) {
      if (t.startSec >= aSec && t.startSec < bSec) {
        if (t.consumed || t.missed) {
          const j = this.judgments.get(t.index);
          if (j) this.counts[j]--;
          this.judgments.delete(t.index);
        }
        t.consumed = false;
        t.missed = false;
      }
    }
  }

  /** True when every target's window has closed or been consumed. */
  done(songTime: number): boolean {
    const w = this.windowSongSec();
    return this.targets.every((t) => t.consumed || t.missed || songTime - t.startSec > w);
  }

  getCounts(): ScoreCounts {
    return { ...this.counts };
  }

  accuracy(): number {
    const judged = this.counts.hit + this.counts.early + this.counts.late + this.counts.miss;
    if (judged === 0) return 0;
    return (this.counts.hit + this.counts.early + this.counts.late) / judged;
  }
}

export function handMatches(hand: Hand, filter: 'L' | 'R' | 'both'): boolean {
  return filter === 'both' || hand === filter || hand === 'unknown';
}
