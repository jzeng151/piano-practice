// Vendors the Splendid Grand Piano samples into public/samples/ so the app
// has no runtime third-party CDN dependency. Run once (postinstall/CI); files
// are skipped if already present. Sample names come from smplr's LAYERS table.
import { LAYERS } from 'smplr';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const UPSTREAM = 'https://smpldsnds.github.io/sfzinstruments-splendid-grand-piano/samples';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'samples', 'splendid-grand-piano');

const names = new Set();
for (const layer of LAYERS) {
  for (const [, name] of layer.samples) names.add(String(name));
}

await mkdir(outDir, { recursive: true });
let fetched = 0;
let skipped = 0;
let failed = 0;
// Both formats: smplr picks one at runtime via canPlayType — ogg for most
// browsers, m4a where Ogg/Opus decode is unavailable.
for (const format of ['ogg', 'm4a']) {
  for (const name of names) {
    const file = `${name}.${format}`;
    // '#' in a path is fragment-ambiguous for static servers — store renamed;
    // the app's storage shim (src/audio/piano.ts) rewrites requests to match.
    const dest = join(outDir, file.replaceAll('#', '_sharp_'));
    try {
      await access(dest);
      skipped++;
      continue;
    } catch {
      // not present — fetch
    }
    const res = await fetch(`${UPSTREAM}/${encodeURIComponent(file)}`);
    if (!res.ok) {
      console.error(`FAILED ${file}: ${res.status}`);
      failed++;
      continue;
    }
    await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    fetched++;
  }
}
console.log(`samples: ${fetched} fetched, ${skipped} already present, ${failed} failed`);
if (failed > 0) process.exit(1);
