import { openDB, type IDBPDatabase } from 'idb';
import type { PracticeSong, ImportWarning } from '../songs/types';

export const SCHEMA_VERSION = 1;
export const COMPILER_VERSION = 1;

export interface StoredSong {
  id: string; // content hash of originalBytes
  schemaVersion: number;
  compilerVersion: number;
  song: PracticeSong;
  originalBytes: ArrayBuffer;
  originalName: string;
  warnings: ImportWarning[];
  importedAt: number;
}

export interface PieceSettings {
  songId: string;
  mode: 'wait' | 'scroll';
  speed: number;
  hands: 'L' | 'R' | 'both';
}

interface AppSettings {
  key: 'app';
  pedalLatch: boolean;
  seenMappingIntro: boolean;
}

const DB_NAME = 'piano-practice';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;
let unavailable = false;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('songs')) {
          db.createObjectStore('songs', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('pieceSettings')) {
          db.createObjectStore('pieceSettings', { keyPath: 'songId' });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      },
    }).catch((e) => {
      unavailable = true;
      throw e;
    });
  }
  return dbPromise;
}

/** True when IndexedDB is unusable (e.g. some private modes). Import is then disabled. */
export async function storageAvailable(): Promise<boolean> {
  if (unavailable) return false;
  try {
    await getDb();
    return true;
  } catch {
    return false;
  }
}

export async function contentHash(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function putSong(record: StoredSong): Promise<void> {
  const db = await getDb();
  await db.put('songs', record);
}

export async function getSong(id: string): Promise<StoredSong | undefined> {
  const db = await getDb();
  return db.get('songs', id);
}

export async function listSongs(): Promise<StoredSong[]> {
  const db = await getDb();
  return db.getAll('songs');
}

export async function deleteSong(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('songs', id);
  await db.delete('pieceSettings', id);
}

export async function getPieceSettings(songId: string): Promise<PieceSettings | undefined> {
  const db = await getDb();
  return db.get('pieceSettings', songId);
}

export async function putPieceSettings(s: PieceSettings): Promise<void> {
  const db = await getDb();
  await db.put('pieceSettings', s);
}

export async function getAppSettings(): Promise<{ pedalLatch: boolean; seenMappingIntro: boolean }> {
  try {
    const db = await getDb();
    const s = (await db.get('settings', 'app')) as AppSettings | undefined;
    return { pedalLatch: s?.pedalLatch ?? false, seenMappingIntro: s?.seenMappingIntro ?? false };
  } catch {
    return { pedalLatch: false, seenMappingIntro: false };
  }
}

export async function putAppSettings(s: { pedalLatch: boolean; seenMappingIntro: boolean }): Promise<void> {
  const db = await getDb();
  await db.put('settings', { key: 'app', ...s });
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!('storage' in navigator) || !navigator.storage.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota };
}
