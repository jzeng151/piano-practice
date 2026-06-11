import { parseMidi } from './midi';
import { parseMusicXml, unzipMxl } from './musicxml';
import type { ImportWarning, PracticeSong } from './types';
import { SongFormatError } from './types';

export interface ParseOutput {
  song: PracticeSong;
  warnings: ImportWarning[];
}

/** Single parse entry point for .mid/.midi/.musicxml/.xml/.mxl. */
export function parseAny(bytes: Uint8Array, fileName: string, id: string): ParseOutput {
  const lower = fileName.toLowerCase();
  const title = fileName.replace(/\.(mid|midi|musicxml|xml|mxl)$/i, '');
  if (lower.endsWith('.mid') || lower.endsWith('.midi')) {
    return { song: parseMidi(bytes, id, title), warnings: [] };
  }
  if (lower.endsWith('.mxl')) {
    return parseMusicXml(unzipMxl(bytes), id, title);
  }
  if (lower.endsWith('.musicxml') || lower.endsWith('.xml')) {
    return parseMusicXml(new TextDecoder().decode(bytes), id, title);
  }
  throw new SongFormatError('Unsupported file type — use .mid, .midi, .musicxml, .xml, or .mxl');
}
