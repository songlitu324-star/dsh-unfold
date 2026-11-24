/**
 * Speech for the lecture.
 *
 * The notes are read aloud, and "read aloud" means neural voices, not the robot the browser ships:
 * Edge's read-aloud endpoint gives real Mandarin voices over a websocket. `@andresaya/edge-tts` speaks
 * that protocol (SSML, the DRM token, chunked audio), so this module only decides *which* voice, keeps a
 * small cache, and turns every failure into something the page can fall back from.
 *
 * The package is optional: a note still works with the browser's own voices when it is missing, and it
 * usually lives in the DSH profile rather than next to this plugin, so resolution is explicit (see
 * `loadEngine`).
 *
 * @module dsh-unfold/lib/tts
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The voice a lecture uses unless the user picks another one. */
export const DEFAULT_VOICE = 'zh-CN-YunjianNeural';

/**
 * Voices offered in the note's player. Ids are Edge "short names"; `tag` is what the menu shows.
 * Anything else that matches `isVoiceId` is still accepted by the bridge — this list is the menu, not a
 * whitelist.
 */
export const VOICES = [
  { id: 'zh-CN-YunjianNeural', name: '云健', tag: '普通话 · 男 · 沉稳', locale: 'zh-CN' },
  { id: 'zh-CN-YunxiNeural', name: '云希', tag: '普通话 · 男 · 年轻', locale: 'zh-CN' },
  { id: 'zh-CN-YunyangNeural', name: '云扬', tag: '普通话 · 男 · 播音', locale: 'zh-CN' },
  { id: 'zh-CN-YunxiaNeural', name: '云夏', tag: '普通话 · 男 · 少年', locale: 'zh-CN' },
  { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓', tag: '普通话 · 女 · 通用', locale: 'zh-CN' },
  { id: 'zh-CN-XiaoyiNeural', name: '晓伊', tag: '普通话 · 女 · 活泼', locale: 'zh-CN' },
  { id: 'zh-CN-XiaobeiNeural', name: '晓北', tag: '东北话 · 女', locale: 'zh-CN' },
  { id: 'zh-CN-liaoning-XiaobeiNeural', name: '晓北', tag: '辽宁话 · 女', locale: 'zh-CN' },
  { id: 'zh-TW-HsiaoChenNeural', name: '曉臻', tag: '台湾 · 女', locale: 'zh-TW' },
  { id: 'zh-HK-HiuMaanNeural', name: '曉曼', tag: '粤语 · 女', locale: 'zh-HK' },
  { id: 'en-US-JennyNeural', name: 'Jenny', tag: 'English · female', locale: 'en-US' },
  { id: 'en-GB-RyanNeural', name: 'Ryan', tag: 'English · male', locale: 'en-GB' },
];

/** Shape check for a voice id: `<lang>-<REGION>[-<variant>]-<Name>Neural`. */
export function isVoiceId(value) {
  return typeof value === 'string' && /^[a-z]{2,3}-[A-Z]{2,}(-[A-Za-z]{2,})?-[A-Za-z]{2,}Neural$/.test(value);
}

/** `1.35` → `+35%`, `0.75` → `-25%`; Edge wants prosody percentages, not a multiplier. */
export function rateOf(speed) {
  const n = Number(speed);
  if (!Number.isFinite(n) || n <= 0) return '+0%';
  const percent = Math.round((Math.min(2.5, Math.max(0.5, n)) - 1) * 100);
  return `${percent >= 0 ? '+' : ''}${percent}%`;
}

/** Synthesized clips, keyed by voice + rate + text. A lecture repeats short lines, so this pays off. */
const cache = new Map();
const CACHE_LIMIT = 96;

const digest = (text) => createHash('sha1').update(text).digest('hex').slice(0, 20);

/** @type {Promise<object|undefined>|undefined} */
let enginePromise;
/** @type {string|undefined} */
let engineNote;

/**
 * Load the TTS engine once. It lives in the DSH profile (that is where the profile installs its
 * packages) while this plugin may be linked from anywhere, so plain `import` is not enough.
 *
 * @returns {Promise<{generate:(text:string,voice:string,opts:object)=>Promise<{audio:Buffer}>}|undefined>}
 */
async function loadEngine() {
  if (enginePromise !== undefined) return enginePromise;
  enginePromise = (async () => {
    const candidates = [];
    if (process.env.DSH_PROFILE_DIR) candidates.push(join(process.env.DSH_PROFILE_DIR, 'noop.js'));
    if (process.env.DSH_HOME) {
      candidates.push(join(process.env.DSH_HOME, 'profiles', process.env.DSH_PROFILE ?? 'desktop', 'noop.js'));
    }
    candidates.push(join(process.cwd(), 'noop.js'));
    for (const anchor of candidates) {
      try {
        const require = createRequire(anchor);
        const resolved = require.resolve('@andresaya/edge-tts');
        const mod = await import(pathToFileURL(resolved).href);
        const EdgeTTS = mod.EdgeTTS ?? mod.default?.EdgeTTS;
        if (typeof EdgeTTS === 'function') return { EdgeTTS, origin: resolved };
      } catch {
        /* try the next anchor */
      }
    }
    try {
      const mod = await import('@andresaya/edge-tts');
      const EdgeTTS = mod.EdgeTTS ?? mod.default?.EdgeTTS;
      if (typeof EdgeTTS === 'function') return { EdgeTTS, origin: 'node_modules' };
    } catch {
      /* not installed next to the plugin either */
    }
    engineNote = 'tts engine missing (@andresaya/edge-tts not found in the DSH profile)';
    return undefined;
  })();
  return enginePromise;
}

/**
 * Is speech available at all, and with which engine?
 * @returns {Promise<{ok:boolean, voice:string, reason?:string}>}
 */
export async function probeTts() {
  const engine = await loadEngine();
  if (engine === undefined) return { ok: false, voice: DEFAULT_VOICE, reason: engineNote ?? 'tts engine missing' };
  return { ok: true, voice: DEFAULT_VOICE };
}

/**
 * Turn text into an mp3.
 *
 * @param {object} options
 * @param {string} options.text - what to say (already length-checked by the caller)
 * @param {string} [options.voice] - Edge voice id; defaults to {@link DEFAULT_VOICE}
 * @param {string|number} [options.rate] - `+20%` or a multiplier such as `1.2`
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<Buffer>} mp3 bytes
 * @throws {Error} when the engine is missing or the endpoint refuses
 */
export async function synthesize({ text, voice, rate, signal }) {
  const spoken = String(text ?? '').trim();
  if (spoken.length === 0) throw new Error('empty text');
  const engine = await loadEngine();
  if (engine === undefined) throw new Error(engineNote ?? 'tts engine missing');

  const voiceId = isVoiceId(voice) ? voice : DEFAULT_VOICE;
  const prosody = typeof rate === 'number' ? rateOf(rate) : typeof rate === 'string' && rate !== '' ? rate : '+0%';
  const key = `${voiceId}|${prosody}|${digest(spoken)}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const tts = new engine.EdgeTTS();
  const result = await tts.generate(spoken, voiceId, { rate: prosody, signal, timeout: 20_000 });
  const audio = result?.audio ?? result;
  if (!(audio instanceof Uint8Array) || audio.length === 0) throw new Error('empty audio');
  const buffer = Buffer.isBuffer(audio) ? audio : Buffer.from(audio);
  cache.set(key, buffer);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return buffer;
}

/** Test hook: forget cached clips. */
export function clearCache() {
  cache.clear();
}

/**
 * Where the mp3 files live when a cache is persisted. Kept out of the notes: an mp3 next to a note is
 * one more file to lose, and re-synthesis is a second.
 */
export function cacheDir(home) {
  return join(home ?? process.env.DSH_HOME ?? '.', 'dsh-unfold', 'tts');
}

/** Whether a voice id is in the menu (not a requirement, just for UI hints). */
export function isMenuVoice(id) {
  return VOICES.some((voice) => voice.id === id);
}
