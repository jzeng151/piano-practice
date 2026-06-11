import { XMLParser } from 'fast-xml-parser';
import { unzipSync, strFromU8 } from 'fflate';
import type { Hand, PracticeSong, SongNote, TempoEvent, ImportWarning } from './types';
import { SongFormatError } from './types';
import { withDerived } from './compile';

export const MXL_DECOMPRESSED_CAP = 20 * 1024 * 1024; // 20 MB
export const MXL_ENTRY_CAP = 200;

export const REJECT_MESSAGE = 'expand repeats in your editor or export MIDI instead';

// Internal PPQ for MusicXML (file divisions vary and can change mid-part).
const XML_PPQ = 480;

const STEP_SEMITONES: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

interface ParsedResult {
  song: PracticeSong;
  warnings: ImportWarning[];
}

// fast-xml-parser preserveOrder node: { [tag]: OrderedNode[], ':@'?: attrs, '#text'?: value }
type Ordered = Record<string, unknown>;

function tagOf(node: Ordered): string {
  return Object.keys(node).find((k) => k !== ':@' && k !== '#text') ?? '';
}

function childrenOf(node: Ordered): Ordered[] {
  const tag = tagOf(node);
  const v = node[tag];
  return Array.isArray(v) ? (v as Ordered[]) : [];
}

function attrsOf(node: Ordered): Record<string, unknown> {
  return (node[':@'] as Record<string, unknown>) ?? {};
}

function firstChild(node: Ordered, tag: string): Ordered | undefined {
  return childrenOf(node).find((c) => tagOf(c) === tag);
}

function children(node: Ordered, tag: string): Ordered[] {
  return childrenOf(node).filter((c) => tagOf(c) === tag);
}

function textOf(node: Ordered | undefined): string {
  if (!node) return '';
  const kids = childrenOf(node);
  const textNode = kids.find((c) => '#text' in c);
  return textNode ? String((textNode as Record<string, unknown>)['#text']) : '';
}

function numOf(node: Ordered | undefined): number | undefined {
  const n = parseFloat(textOf(node));
  return Number.isFinite(n) ? n : undefined;
}

function attrNum(node: Ordered, name: string): number | undefined {
  const v = attrsOf(node)[name];
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : undefined;
}

/** Depth-first scan for constructs we refuse to silently miscompile. */
function detectRejectedConstructs(node: Ordered): string | null {
  const tag = tagOf(node);
  if (tag === 'repeat') return 'repeat barlines';
  if (tag === 'ending') return 'voltas';
  if (tag === 'segno' || tag === 'coda') return 'segno/coda marks';
  if (tag === 'words') {
    const text = textOf(node);
    if (/\bD\.?\s?[CS]\.?\b|da capo|dal segno/i.test(text)) return `the direction "${text.trim()}"`;
  }
  for (const child of childrenOf(node)) {
    const hit = detectRejectedConstructs(child);
    if (hit) return hit;
  }
  return null;
}

/** Parse a MusicXML string (already unzipped if it came from .mxl). */
export function parseMusicXml(xml: string, id: string, fallbackTitle: string): ParsedResult {
  if (/<!DOCTYPE[^>]*\[/.test(xml)) {
    // Internal DTD subset — entity tricks; the doctype is dispensable for MusicXML.
    throw new SongFormatError('Not a valid MusicXML file');
  }
  const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: '',
    removeNSPrefix: true,
    parseTagValue: true,
    processEntities: false,
  });
  let doc: Ordered[];
  try {
    doc = parser.parse(xml) as Ordered[];
  } catch {
    throw new SongFormatError('Not a valid MusicXML file');
  }

  if (doc.some((n) => tagOf(n) === 'score-timewise')) {
    throw new SongFormatError('Timewise MusicXML is not supported — export partwise or MIDI');
  }
  const score = doc.find((n) => tagOf(n) === 'score-partwise');
  if (!score) throw new SongFormatError('Not a valid MusicXML file');

  const rejected = detectRejectedConstructs(score);
  if (rejected) {
    throw new SongFormatError(`File contains ${rejected} — ${REJECT_MESSAGE}`);
  }

  const warnings: ImportWarning[] = [];

  const work = firstChild(score, 'work');
  const title =
    textOf(work ? firstChild(work, 'work-title') : undefined) ||
    textOf(firstChild(score, 'movement-title')) ||
    fallbackTitle;
  const identification = firstChild(score, 'identification');
  let composer = '';
  if (identification) {
    const creators = children(identification, 'creator');
    const byType = creators.find((c) => attrsOf(c)['type'] === 'composer');
    composer = textOf(byType ?? creators[0]);
  }

  // Pick the densest part (warn on multi-part).
  const parts = children(score, 'part');
  if (parts.length === 0) throw new SongFormatError('File contains no playable notes');
  const density = (p: Ordered) =>
    children(p, 'measure').reduce((s, m) => s + children(m, 'note').length, 0);
  let chosen = parts[0];
  if (parts.length > 1) {
    chosen = parts.reduce((a, b) => (density(b) > density(a) ? b : a));
    warnings.push({
      kind: 'multi-part',
      message: `File has ${parts.length} parts — imported the densest one`,
    });
  }

  const notes: SongNote[] = [];
  const tempoMap: TempoEvent[] = [];
  let divisions = 1;
  let graceDropped = 0;
  let cursorTick = 0;
  let lastNoteStart = 0;

  const toTicks = (durDivisions: number): number => (durDivisions / divisions) * XML_PPQ;

  for (const measure of children(chosen, 'measure')) {
    for (const el of childrenOf(measure)) {
      const tag = tagOf(el);

      if (tag === 'attributes') {
        const d = numOf(firstChild(el, 'divisions'));
        if (d && d > 0) divisions = d;
        if (firstChild(el, 'transpose')) {
          throw new SongFormatError('Transposing-instrument parts are not supported — export MIDI instead');
        }
      } else if (tag === 'direction' || tag === 'sound') {
        const sounds = tag === 'sound' ? [el] : children(el, 'sound');
        for (const s of sounds) {
          const bpm = attrNum(s, 'tempo');
          if (bpm) tempoMap.push({ tick: Math.round(cursorTick), bpm });
        }
      } else if (tag === 'backup') {
        const d = numOf(firstChild(el, 'duration'));
        if (d) cursorTick -= toTicks(d);
      } else if (tag === 'forward') {
        const d = numOf(firstChild(el, 'duration'));
        if (d) cursorTick += toTicks(d);
      } else if (tag === 'note') {
        const isChord = !!firstChild(el, 'chord');
        const isGrace = !!firstChild(el, 'grace');
        const isRest = !!firstChild(el, 'rest');
        const dur = numOf(firstChild(el, 'duration')) ?? 0;
        const durTicks = toTicks(dur);

        if (isGrace) {
          graceDropped++;
          continue; // no duration; dropped with a visible warning
        }

        const startTick = isChord ? lastNoteStart : cursorTick;
        if (!isChord) {
          lastNoteStart = cursorTick;
          cursorTick += durTicks;
        }
        if (isRest || durTicks <= 0) continue;

        const pitch = firstChild(el, 'pitch');
        if (!pitch) continue;
        const step = textOf(firstChild(pitch, 'step'));
        const octave = numOf(firstChild(pitch, 'octave'));
        if (!(step in STEP_SEMITONES) || octave === undefined) continue;
        const alter = numOf(firstChild(pitch, 'alter')) ?? 0;
        const midi = (octave + 1) * 12 + STEP_SEMITONES[step] + alter;
        if (midi < 0 || midi > 127) continue;

        // tie stop extends the previous same-pitch note it abuts
        const tieTypes = children(el, 'tie').map((t) => attrsOf(t)['type']);
        if (tieTypes.includes('stop')) {
          const prev = [...notes]
            .reverse()
            .find((n) => n.midi === midi && Math.abs(n.startTick + n.durationTick - startTick) <= 2);
          if (prev) {
            prev.durationTick += Math.max(1, Math.round(durTicks));
            continue;
          }
        }

        const staff = numOf(firstChild(el, 'staff'));
        const hand: Hand = staff === 1 ? 'R' : staff === 2 ? 'L' : 'unknown';

        notes.push({
          startTick: Math.round(startTick),
          durationTick: Math.max(1, Math.round(durTicks)),
          midi,
          hand,
          velocity: 90,
        });
      }
    }
  }

  if (graceDropped > 0) {
    warnings.push({
      kind: 'grace-notes-dropped',
      message: `Grace notes were omitted (${graceDropped} dropped)`,
    });
  }

  const song = withDerived({
    id,
    title: String(title),
    composer,
    source: 'musicxml',
    ppq: XML_PPQ,
    tempoMap,
    notes,
    pedalEvents: [],
    playableRange: { min: 0, max: 0 },
    maxSimultaneity: 0,
    baseWindowOffset: 0,
  });

  return { song, warnings };
}

/** Unzip a .mxl (MusicXML ZIP container) with size/entry caps. */
export function unzipMxl(bytes: Uint8Array): string {
  let files: Record<string, Uint8Array>;
  try {
    let total = 0;
    let entries = 0;
    files = unzipSync(bytes, {
      filter: (file) => {
        entries++;
        total += file.originalSize ?? 0;
        if (entries > MXL_ENTRY_CAP || total > MXL_DECOMPRESSED_CAP) {
          throw new SongFormatError('Archive is corrupt or too large');
        }
        // Only extract container.xml and XML rootfiles — skip images/fonts.
        return file.name === 'META-INF/container.xml' || /\.(xml|musicxml)$/i.test(file.name);
      },
    });
  } catch (e) {
    if (e instanceof SongFormatError) throw e;
    throw new SongFormatError('Archive is corrupt or too large');
  }

  const container = files['META-INF/container.xml'];
  if (!container) throw new SongFormatError('Not a valid .mxl archive (missing container.xml)');
  const containerXml = strFromU8(container);
  const m = containerXml.match(/full-path="([^"]+)"/);
  if (!m) throw new SongFormatError('Not a valid .mxl archive (no rootfile)');
  const rootfile = files[m[1]];
  if (!rootfile) throw new SongFormatError('Not a valid .mxl archive (rootfile missing)');
  if (rootfile.length > MXL_DECOMPRESSED_CAP) {
    throw new SongFormatError('Archive is corrupt or too large');
  }
  return strFromU8(rootfile);
}
