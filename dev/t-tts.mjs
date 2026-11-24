/**
 * Synthesis smoke test: resolve the TTS package the way the plugin does, synthesize one sentence.
 * Usage: node dev/t-tts.mjs [voice] [text]
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';

const profile = process.env.DSH_PROFILE_DIR ?? 'C:\\Users\\tuson\\.dsh\\profiles\\desktop';
const require = createRequire(join(profile, 'noop.js'));
const mod = await import(pathToFileURL(require.resolve('@andresaya/edge-tts')).href);
const EdgeTTS = mod.EdgeTTS ?? mod.default?.EdgeTTS;

const voice = process.argv[2] ?? 'zh-CN-YunjianNeural';
const text = process.argv[3] ?? '注意力机制让每个位置都能直接看到所有位置，所以不用一步一步算了。';

const started = Date.now();
const result = await new EdgeTTS().generate(text, voice, { rate: '+0%', timeout: 20000 });
const audio = result.audio ?? result;
console.log('voice:', voice, 'bytes:', audio.length, 'took:', Date.now() - started, 'ms', 'ctor:', audio.constructor?.name);
await writeFile('C:\\Users\\tuson\\Desktop\\zy\\dsh-unfold\\.tmp\\tts.mp3', audio);
