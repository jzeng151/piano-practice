import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listBuiltins } from '../songs/library';
import { listSongs, deleteSong, storageAvailable, type StoredSong } from '../storage/db';

interface ImportRow {
  record: StoredSong | null; // null = corrupt row
  id: string;
  name: string;
}

export default function Library() {
  const [imports, setImports] = useState<ImportRow[] | null>(null); // null = loading
  const [storageOk, setStorageOk] = useState(true);

  const refresh = async () => {
    if (!(await storageAvailable())) {
      setStorageOk(false);
      setImports([]);
      return;
    }
    try {
      const songs = await listSongs();
      setImports(
        songs
          .sort((a, b) => b.importedAt - a.importedAt)
          .map((record) => {
            const valid =
              record &&
              typeof record.id === 'string' &&
              record.song &&
              Array.isArray(record.song.notes) &&
              record.song.notes.length > 0;
            return valid
              ? { record, id: record.id, name: record.song.title }
              : { record: null, id: record?.id ?? 'corrupt', name: record?.originalName ?? 'unknown' };
          }),
      );
    } catch {
      setStorageOk(false);
      setImports([]);
    }
  };

  useEffect(() => {
    // async — every setState inside happens after an await (post-paint)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, []);

  const builtins = listBuiltins();
  const easiest = builtins[0];

  return (
    <main className="page library">
      <h1>Piano Practice</h1>
      {!storageOk && (
        <p className="banner" role="alert">
          Storage unavailable — imported songs won't persist in this browser session.
        </p>
      )}

      <section aria-label="Built-in pieces">
        <h2>Built-in pieces</h2>
        <ul className="song-list">
          {builtins.map((b) => (
            <li key={b.id} className="song-row">
              <Link to={`/practice/${b.id}`} className="song-main">
                <span className="song-title">
                  {b.title}
                  {b.id === easiest.id && <span className="start-here"> Start here</span>}
                </span>
                <span className="song-composer">{b.composer}</span>
              </Link>
              <span className="difficulty" aria-label={`difficulty ${b.difficulty} of 3`}>
                {'●'.repeat(b.difficulty)}
                {'○'.repeat(3 - b.difficulty)}
              </span>
              <Link className="button" to={`/practice/${b.id}`}>
                Practice
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Your imports">
        <h2>Your imports</h2>
        {imports === null ? (
          <ul className="song-list skeleton" aria-hidden="true">
            {[1, 2].map((i) => (
              <li key={i} className="song-row placeholder" />
            ))}
          </ul>
        ) : imports.length === 0 ? (
          <p className="empty-card">
            No imported songs yet. <Link to="/import">Import a MIDI or MusicXML file →</Link>
          </p>
        ) : (
          <ul className="song-list">
            {imports.map((row) =>
              row.record ? (
                <li key={row.id} className="song-row">
                  <Link to={`/practice/${row.id}`} className="song-main">
                    <span className="song-title">{row.name}</span>
                    <span className="song-composer">{row.record.song.composer || row.record.originalName}</span>
                  </Link>
                  {row.record.warnings.length > 0 && (
                    <span className="warn-tag" title={row.record.warnings.map((w) => w.message).join('; ')}>
                      ⚠
                    </span>
                  )}
                  <Link className="button" to={`/practice/${row.id}`}>
                    Practice
                  </Link>
                  <button
                    onClick={async () => {
                      await deleteSong(row.id);
                      refresh();
                    }}
                  >
                    Remove
                  </button>
                </li>
              ) : (
                <li key={row.id} className="song-row broken">
                  <span>“{row.name}” couldn't be read from storage.</span>
                  <button
                    onClick={async () => {
                      await deleteSong(row.id);
                      refresh();
                    }}
                  >
                    Remove
                  </button>
                </li>
              ),
            )}
          </ul>
        )}
        <p>
          <Link to="/import">Import songs</Link>
        </p>
      </section>

      <footer>
        <Link to="/keyboard-test">Test your keyboard's chord limits</Link>
      </footer>
    </main>
  );
}
