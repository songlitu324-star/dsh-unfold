/**
 * Resolve an optional dependency that lives in the DSH profile rather than next to this package.
 * The plugin is installed by link/junction, so Node resolves from the *real* plugin path and never
 * looks inside the profile's node_modules; the profile is the one place the package is guaranteed to be.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const candidates = [];
if (process.env.DSH_PROFILE_DIR) candidates.push(join(process.env.DSH_PROFILE_DIR, 'noop.js'));
if (process.env.DSH_HOME) candidates.push(join(process.env.DSH_HOME, 'profiles', process.env.DSH_PROFILE ?? 'desktop', 'noop.js'));
candidates.push(join(process.cwd(), 'noop.js'));

let mod;
for (const at of candidates) {
  try {
    const require = createRequire(at);
    const resolved = require.resolve('@andresaya/edge-tts');
    mod = await import(pathToFileURL(resolved).href);
    console.log('resolved from', at, '→', resolved);
    break;
  } catch (error) {
    console.log('miss', at, String(error?.code ?? error?.message).slice(0, 80));
  }
}
if (mod === undefined) {
  console.log('fallback: plain import');
  mod = await import('@andresaya/edge-tts');
}
const EdgeTTS = mod.EdgeTTS ?? mod.default?.EdgeTTS;
console.log('EdgeTTS:', typeof EdgeTTS);
