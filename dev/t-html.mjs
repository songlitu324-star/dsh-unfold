/**
 * Structural check of a built note, without a browser: pull the inline script out and syntax-check it
 * with node, and parse the embedded data JSON the page renders from.
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const file = process.argv[2];
const html = readFileSync(file, 'utf8');

const dataMatch = /<script id="data" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
if (!dataMatch) throw new Error('no data script');
const data = JSON.parse(dataMatch[1]);
console.log('data keys:', Object.keys(data).join(','));
console.log('title:', data.title);
console.log('sections:', data.sections.length, 'blocks:', data.sections.reduce((n, s) => n + s.blocks.length, 0));
console.log('beats:', data.lecture.length, 'crops:', data.crops.length);
console.log('crops with png:', data.crops.filter((c) => typeof c.png === 'string' && c.png.length > 100).length);
console.log('bridge:', JSON.stringify(data.bridge ?? null));
if (data.tts) console.log('tts voice:', data.tts.voice, '| menu:', (data.tts.voices || []).length, '| url:', data.tts.url);

const cites = [];
for (const s of data.sections) for (const b of s.blocks) for (const c of b.cites ?? []) cites.push(c);
console.log('cites:', cites.length, 'pointing at crops:', cites.filter((c) => typeof c.crop === 'number').length);
console.log('cite pages:', [...new Set(cites.map((c) => `${c.doc} p.${c.page}`))].join(' | '));

// Inline <script> blocks (skip the JSON one) must parse.
const scripts = [...html.matchAll(/<script(?![^>]*application\/json)(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
console.log('inline scripts:', scripts.length, 'chars:', scripts.map((s) => s.length).join(','));
const dir = mkdtempSync(join(tmpdir(), 'unfold-check-')) ?? '.tmp';
let i = 0;
for (const source of scripts) {
  i += 1;
  const path = join(dir, `s${i}.mjs`);
  try {
    writeFileSync(path, source, 'utf8');
  } catch {
    writeFileSync(`.tmp/s${i}.mjs`, source, 'utf8');
  }
}
for (let j = 1; j <= i; j += 1) {
  const candidates = [join(dir, `s${j}.mjs`), `.tmp/s${j}.mjs`];
  for (const candidate of candidates) {
    try {
      execFileSync(process.execPath, ['--check', candidate], { stdio: 'ignore' });
      console.log(`script ${j}: syntax ok`);
      break;
    } catch (error) {
      if (String(error?.message ?? '').includes('ENOENT')) continue;
      console.log(`script ${j}: SYNTAX ERROR`);
      try {
        execFileSync(process.execPath, ['--check', candidate], { stdio: 'inherit' });
      } catch {
        /* reported below */
      }
      break;
    }
  }
}

// Every placeholder must have been replaced.
for (const marker of ['UNFOLD:DATA', 'UNFOLD:TITLE', 'UNFOLD:BUILT']) {
  if (html.includes(`<!--${marker}-->`)) console.log(`placeholder left: ${marker}`);
}
console.log('bytes:', html.length);
