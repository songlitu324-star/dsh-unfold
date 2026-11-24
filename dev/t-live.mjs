/**
 * End-to-end check against the running DSH (run after the plugin is loaded):
 *   1. the bridge route answers
 *   2. a lecture beat reaches the pet as a bubble + an animation
 *   3. stop clears the bubble and releases the lock
 *   4. the voice catalogue answers and a real mp3 comes back
 *
 * The base can be either the host (`http://127.0.0.1:<host port>`, routes under `/dsh-unfold`) or the
 * stand-in listener notes talk to (`http://127.0.0.1:51230`, routes at the root). Both are checked for.
 *
 * Usage: node dev/t-live.mjs [base]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:51230').replace(/\/+$/, '');
const PROJECT = 'C:\\Users\\tuson\\Desktop\\zy\\.unfold\\attention';
const token = JSON.parse(readFileSync(join(PROJECT, 'project.json'), 'utf8')).bridgeToken;

// Both mounts share one handler; only the prefix differs. Probe for it once.
const PREFIX = await (async () => {
  const res = await fetch(`${BASE}/dsh-unfold/status`, { signal: AbortSignal.timeout(5000) });
  return res.status === 200 ? '/dsh-unfold' : '';
})();

const get = async (path) => {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(8000) });
  return { status: res.status, body: await res.text() };
};
const post = async (path, body, headers = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  return { status: res.status, body: await res.text() };
};

console.log(`base ${BASE} | routes at "${PREFIX || '/'}"`);

const status = await get(`${PREFIX}/status`);
const statusJson = JSON.parse(status.body);
console.log('1. bridge status:', status.status, status.body);

// The pet lives on the host's own port, which is not necessarily the base we came in on.
const petBase = statusJson.origin ?? BASE;
const petState = async () => {
  const res = await fetch(`${petBase}/dsh-pet-7340/state`, { signal: AbortSignal.timeout(8000) });
  const tree = await res.json();
  return tree?.pets?.main ?? Object.values(tree?.pets ?? {})[0] ?? {};
};

const bubble = await post(
  `${PREFIX}/teach`,
  { text: '注意力让每个位置能直接看到所有位置，所以不用一步一步算。', anim: '写代码', block: 'b1' },
  { 'x-unfold-token': token },
);
console.log('2. teach:', bubble.status, bubble.body);

await new Promise((r) => setTimeout(r, 300));
const pet = await petState();
console.log('3. pet say:', JSON.stringify(pet.say?.data ?? null).slice(0, 160));
console.log('   pet anim:', JSON.stringify(pet.anim?.data ?? null).slice(0, 120));

const stop = await post(`${PREFIX}/stop`, {}, { 'x-unfold-token': token });
console.log('4. stop:', stop.status, stop.body);
await new Promise((r) => setTimeout(r, 300));
console.log('5. bubble after stop:', JSON.stringify((await petState()).say?.data ?? null).slice(0, 120));

// 6. Speech: the voice catalogue, then one real synthesis. The mp3 must be actual audio bytes.
const voices = JSON.parse((await get(`${PREFIX}/voice`)).body);
const sample = (voices.voices ?? []).find((v) => v.id === voices.default) ?? { name: '(none)' };
console.log('6. voices:', (voices.voices ?? []).length, '| default:', voices.default, `(${sample.name})`, '| engine ok:', voices.engine?.ok);

const spoken = await fetch(`${BASE}${PREFIX}/tts`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-unfold-token': token },
  body: JSON.stringify({ text: '注意力机制让每个位置都能直接看到所有位置。', voice: voices.default, rate: 1 }),
  signal: AbortSignal.timeout(30000),
});
const audio = Buffer.from(await spoken.arrayBuffer());
console.log('7. tts:', spoken.status, spoken.headers.get('content-type'), `${audio.length} bytes`,
  '| first bytes:', audio.subarray(0, 3).toString('hex'), audio.length > 1000 ? '| audio ok' : '| TOO SMALL');
