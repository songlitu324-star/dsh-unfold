/**
 * Rehearse the exact call sequence the plugin makes against the live pet, without the plugin:
 * acquire a lock, renew it, teach a beat (bubble + pose, both carrying the lock id), clear, release.
 *
 * Usage: node dev/t-pet.mjs [origin] [petId]
 */
const ORIGIN = process.argv[2] ?? 'http://127.0.0.1:60248';
const PET = process.argv[3] ?? 'main';
const PREFIX = '/dsh-pet-7340';

const call = async (path, body) => {
  const res = await fetch(`${ORIGIN}${PREFIX}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, ok: json?.ok === true, json, text };
};

const q = (lockId, extra = '') =>
  `?pet=${PET}&surface=any${lockId === undefined ? '' : `&lock=${encodeURIComponent(lockId)}`}${extra}`;

const state = await call('/state');
console.log('pets:', Object.keys(state.json?.pets ?? {}));

const take = await call(`/lock${q()}`, { ttl: 600000 });
console.log('1. acquire:', take.status, JSON.stringify(take.json));
if (!take.ok) process.exit(1);
const lockId = take.json.lockId;

const renew = await call(`/lock${q(lockId)}`, { lockId, ttl: 600000 });
console.log('2. renew:', renew.status, JSON.stringify(renew.json));

const say = await call(`/broadcast${q(lockId)}`, {
  text: '【老师】注意力让每个位置能直接看到所有位置，所以不用一步一步算。',
  duration: 12000,
  anim: false,
});
console.log('3. bubble:', say.status, JSON.stringify(say.json));

const pose = await call(`/anim${q(lockId)}`, { name: '写代码' });
console.log('4. pose:', pose.status, JSON.stringify(pose.json));

const shown = await call('/state');
const pet = shown.json?.pets?.[PET] ?? {};
const sayData = pet.say?.data ?? pet.say ?? null;
console.log('5. state say:', JSON.stringify(sayData)?.slice(0, 200));
console.log('   state anim:', JSON.stringify(pet.anim?.data ?? pet.anim ?? null).slice(0, 160));

const clear = await call(`/bubble/clear${q(lockId)}`, {});
console.log('6. clear:', clear.status, JSON.stringify(clear.json));

const release = await call(`/lock/release${q()}`, { lockId });
console.log('7. release:', release.status, JSON.stringify(release.json));
