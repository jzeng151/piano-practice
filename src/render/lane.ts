import type { CompiledSong } from '../songs/types';
import type { EngineSnapshot } from '../engine/clock';
import { WINDOW_SPAN, letterForOffset } from '../input/keyboard';

export const LOOKAHEAD_SONG_SEC = 4; // fixed look-ahead in SONG time

const WHITE_OFFSETS = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17];
const BLACK_OFFSETS = [1, 3, 6, 8, 10, 13, 15];

const COLORS = {
  bg: '#101216',
  laneLine: '#1d2128',
  hitLine: '#e8c266',
  noteR: '#e8913a',
  noteL: '#3aa7a3',
  noteU: '#7d8edb',
  noteBorder: '#0a0b0d',
  satisfied: '#7be87b',
  pulse: '#e8c266',
  wrong: '#e0484d',
  whiteKey: '#dcdfe4',
  whiteKeyDown: '#9fd49f',
  blackKey: '#23262c',
  blackKeyDown: '#5f9e5f',
  guideKey: '#e8c266',
  label: '#14161a',
  labelLight: '#c8ccd4',
  judgments: { hit: '#7be87b', early: '#e8c266', late: '#e8913a', miss: '#e0484d' } as Record<string, string>,
  loop: '#7d8edb',
};

const KEYBOARD_FRACTION = 0.22; // bottom share of canvas for the keyboard

/**
 * Canvas renderer: falling-note lane over the on-screen keyboard. Columns are
 * the 18 semitone positions of the SONG's window only. DPR-aware via
 * ResizeObserver; pure draw from (snapshot, compiled) each frame.
 */
export class LaneRenderer {
  private ctx: CanvasRenderingContext2D;
  private observer: ResizeObserver;
  private cssWidth = 0;
  private cssHeight = 0;

  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    this.ctx = ctx;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
  }

  destroy(): void {
    this.observer.disconnect();
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.cssWidth = rect.width;
    this.cssHeight = rect.height;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(snapshot: EngineSnapshot, compiled: CompiledSong, songWindowBase: number): void {
    const { ctx, cssWidth: w, cssHeight: h } = this;
    if (w === 0 || h === 0) return;
    // DPR can change mid-session (zoom, monitor move)
    const dpr = window.devicePixelRatio || 1;
    if (Math.round(this.cssWidth * dpr) !== this.canvas.width) this.resize();

    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);

    const kbH = h * KEYBOARD_FRACTION;
    const hitY = h - kbH;
    const laneH = hitY;
    const colW = w / WINDOW_SPAN;
    const pxPerSec = laneH / LOOKAHEAD_SONG_SEC;

    // column separators
    ctx.strokeStyle = COLORS.laneLine;
    ctx.lineWidth = 1;
    for (let i = 1; i < WINDOW_SPAN; i++) {
      ctx.beginPath();
      ctx.moveTo(i * colW, 0);
      ctx.lineTo(i * colW, hitY);
      ctx.stroke();
    }

    // loop markers
    if (snapshot.loopA !== null) this.drawLoopLine(snapshot.loopA, snapshot, hitY, pxPerSec, w, 'A');
    if (snapshot.loopB !== null) this.drawLoopLine(snapshot.loopB, snapshot, hitY, pxPerSec, w, 'B');

    // falling notes
    const pulse = 0.55 + 0.45 * Math.sin(performance.now() / 180);
    let noteIndex = 0;
    for (let gi = 0; gi < compiled.groups.length; gi++) {
      const g = compiled.groups[gi];
      const isGating = gi === snapshot.gatingGroup;
      for (const n of g.notes) {
        const idx = noteIndex++;
        const offset = n.midi - songWindowBase;
        if (offset < 0 || offset >= WINDOW_SPAN) continue;
        const dy = (g.startSec - snapshot.songTime) * pxPerSec;
        const top = hitY - dy - n.durationSec * pxPerSec;
        const height = Math.max(8, n.durationSec * pxPerSec);
        if (top > hitY || top + height < -20) continue;

        const judgment = snapshot.judgments.get(idx);
        let fill =
          n.hand === 'L' ? COLORS.noteL : n.hand === 'R' ? COLORS.noteR : COLORS.noteU;
        if (judgment) fill = COLORS.judgments[judgment];
        if (isGating) {
          fill = snapshot.satisfied.has(n.midi) ? COLORS.satisfied : COLORS.pulse;
        }

        ctx.globalAlpha = isGating && !snapshot.satisfied.has(n.midi) ? pulse : 1;
        ctx.fillStyle = fill;
        const x = offset * colW + 2;
        const noteW = colW - 4;
        ctx.beginPath();
        ctx.roundRect(x, top, noteW, Math.min(height, hitY - top), 4);
        ctx.fill();
        ctx.globalAlpha = 1;

        // letter label at the bottom of the note
        const labelY = Math.min(top + Math.min(height, hitY - top) - 5, hitY - 5);
        if (labelY > 10) {
          ctx.fillStyle = COLORS.label;
          ctx.font = `bold ${Math.min(14, colW * 0.5)}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(letterForOffset(offset), x + noteW / 2, labelY);
        }
      }
    }

    // wrong-press transient marks (~300 ms decay) in the lane column
    const now = performance.now();
    for (const f of snapshot.wrongFlashes) {
      const age = now - f.atReal;
      if (age > 300) continue;
      const offset = f.midi - songWindowBase;
      if (offset < 0 || offset >= WINDOW_SPAN) continue;
      ctx.globalAlpha = 1 - age / 300;
      ctx.fillStyle = COLORS.wrong;
      ctx.fillRect(offset * colW + 2, hitY - 26, colW - 4, 22);
      ctx.globalAlpha = 1;
    }

    // hit line
    ctx.strokeStyle = COLORS.hitLine;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, hitY);
    ctx.lineTo(w, hitY);
    ctx.stroke();

    this.drawKeyboard(snapshot, compiled, songWindowBase, hitY, kbH, colW, now);
  }

  private drawLoopLine(
    sec: number,
    snapshot: EngineSnapshot,
    hitY: number,
    pxPerSec: number,
    w: number,
    label: string,
  ): void {
    const y = hitY - (sec - snapshot.songTime) * pxPerSec;
    if (y < 0 || y > hitY) return;
    const { ctx } = this;
    ctx.strokeStyle = COLORS.loop;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COLORS.loop;
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(label, 4, y - 4);
  }

  private drawKeyboard(
    snapshot: EngineSnapshot,
    compiled: CompiledSong,
    songWindowBase: number,
    hitY: number,
    kbH: number,
    colW: number,
    now: number,
  ): void {
    const { ctx } = this;
    const sounding = new Set(snapshot.sounding);
    const wrongRecent = new Set(
      snapshot.wrongFlashes.filter((f) => now - f.atReal < 300).map((f) => f.midi),
    );
    // pitches guided right now: gating group (wait) or notes near the hit line (scroll)
    const guide = new Set<number>();
    if (snapshot.gatingGroup >= 0) {
      const g = compiled.groups[snapshot.gatingGroup];
      for (const n of g.notes) guide.add(n.midi);
    }

    const whiteW = (colW * WINDOW_SPAN) / WHITE_OFFSETS.length;
    // white keys
    WHITE_OFFSETS.forEach((offset, i) => {
      const midi = songWindowBase + offset;
      const x = i * whiteW;
      ctx.fillStyle = wrongRecent.has(midi)
        ? COLORS.wrong
        : sounding.has(midi)
          ? COLORS.whiteKeyDown
          : guide.has(midi)
            ? COLORS.guideKey
            : COLORS.whiteKey;
      ctx.fillRect(x + 1, hitY + 1, whiteW - 2, kbH - 2);
      ctx.strokeStyle = wrongRecent.has(midi) ? COLORS.wrong : COLORS.noteBorder;
      ctx.lineWidth = wrongRecent.has(midi) ? 3 : 1;
      ctx.strokeRect(x + 1, hitY + 1, whiteW - 2, kbH - 2);
      ctx.fillStyle = COLORS.label;
      ctx.font = `bold ${Math.min(15, whiteW * 0.4)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(letterForOffset(offset), x + whiteW / 2, hitY + kbH - 8);
    });
    // black keys sit between whites: position by semitone offset
    for (const offset of BLACK_OFFSETS) {
      const midi = songWindowBase + offset;
      // x centered on the boundary between its neighboring white keys
      const whiteIndexBefore = WHITE_OFFSETS.filter((o) => o < offset).length;
      const x = whiteIndexBefore * whiteW - whiteW * 0.3;
      const bw = whiteW * 0.6;
      const bh = kbH * 0.6;
      ctx.fillStyle = wrongRecent.has(midi)
        ? COLORS.wrong
        : sounding.has(midi)
          ? COLORS.blackKeyDown
          : guide.has(midi)
            ? COLORS.guideKey
            : COLORS.blackKey;
      ctx.fillRect(x, hitY + 1, bw, bh);
      ctx.strokeStyle = COLORS.noteBorder;
      ctx.lineWidth = 1;
      ctx.strokeRect(x, hitY + 1, bw, bh);
      ctx.fillStyle = COLORS.labelLight;
      ctx.font = `bold ${Math.min(12, bw * 0.55)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(letterForOffset(offset), x + bw / 2, hitY + bh - 6);
    }
  }
}
