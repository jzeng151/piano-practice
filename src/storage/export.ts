import { listSongs, putSong, getSong, contentHash, SCHEMA_VERSION, COMPILER_VERSION, type StoredSong } from './db';
import { parseAny } from '../songs/parse';
import { SongFormatError } from '../songs/types';

export const BACKUP_FORMAT_VERSION = 1;
const MAX_BACKUP_SONGS = 500;
const MAX_RAW_BYTES_PER_SONG = 30 * 1024 * 1024; // decoded size cap per song

interface BackupSongEntry {
  id: string;
  originalName: string;
  bytesB64: string;
}

interface BackupFile {
  app: 'piano-practice';
  formatVersion: number;
  exportedAt: string;
  songs: BackupSongEntry[];
}

function toB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

function fromB64(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** Export every imported song (original bytes included) as a JSON backup blob. */
export async function exportBackup(): Promise<Blob> {
  const songs = await listSongs();
  const backup: BackupFile = {
    app: 'piano-practice',
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    songs: songs.map((s) => ({
      id: s.id,
      originalName: s.originalName,
      bytesB64: toB64(s.originalBytes),
    })),
  };
  return new Blob([JSON.stringify(backup)], { type: 'application/json' });
}

export interface RestoreResult {
  restored: number;
  skippedDuplicates: number;
  failed: { name: string; reason: string }[];
}

/**
 * Validate-then-reconstruct: fresh objects are built from validated fields —
 * the parsed JSON is never persisted directly. Songs are recompiled from
 * their original bytes (so a newer compiler benefits restores). Staged and
 * per-song atomic; duplicates skipped with notice.
 */
export async function restoreBackup(json: string): Promise<RestoreResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new SongFormatError('Not a valid backup file');
  }
  if (
    typeof raw !== 'object' || raw === null ||
    (raw as Record<string, unknown>)['app'] !== 'piano-practice' ||
    typeof (raw as Record<string, unknown>)['formatVersion'] !== 'number' ||
    !Array.isArray((raw as Record<string, unknown>)['songs'])
  ) {
    throw new SongFormatError('Not a valid backup file');
  }
  const entries = (raw as Record<string, unknown>)['songs'] as unknown[];
  if (entries.length > MAX_BACKUP_SONGS) {
    throw new SongFormatError('Not a valid backup file');
  }

  const result: RestoreResult = { restored: 0, skippedDuplicates: 0, failed: [] };
  for (const entry of entries) {
    const e = entry as Record<string, unknown>;
    const name = typeof e['originalName'] === 'string' ? (e['originalName'] as string) : 'unknown';
    const b64 = e['bytesB64'];
    if (typeof b64 !== 'string' || b64.length === 0 || b64.length > Math.ceil((MAX_RAW_BYTES_PER_SONG * 4) / 3)) {
      result.failed.push({ name, reason: 'invalid entry' });
      continue;
    }
    try {
      const bytes = fromB64(b64);
      const record = await importFile(new Uint8Array(bytes), name);
      if (record === 'duplicate') result.skippedDuplicates++;
      else result.restored++;
    } catch (err) {
      result.failed.push({
        name,
        reason: err instanceof SongFormatError ? err.message : 'could not be restored',
      });
    }
  }
  return result;
}

/**
 * Shared import path (importer page + restore): parse → store with content-hash
 * id. Returns 'duplicate' when the same bytes are already stored.
 */
export async function importFile(
  bytes: Uint8Array,
  fileName: string,
): Promise<StoredSong | 'duplicate'> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const id = await contentHash(buffer);
  if (await getSong(id)) return 'duplicate';

  const { song, warnings } = parseAny(bytes, fileName, id);

  const record: StoredSong = {
    id,
    schemaVersion: SCHEMA_VERSION,
    compilerVersion: COMPILER_VERSION,
    song,
    originalBytes: buffer,
    originalName: fileName,
    warnings,
    importedAt: Date.now(),
  };
  await putSong(record);
  return record;
}
