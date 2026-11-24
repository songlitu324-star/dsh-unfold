/**
 * The pet, as a teacher.
 *
 * dsh-pet exposes its own little HTTP surface (prefix `/dsh-pet-7340`) on the same web server we are
 * mounted on, so "联动" is just a few local POSTs: play an animation, push a bubble. No import of the
 * pet package, no shared internals — if the pet is not installed, every call here fails quietly and
 * the note keeps teaching on its own.
 *
 * The pet cannot change its sprite (the animation pool is fixed, the avatar of `main` is not
 * replaceable), so the teacher illusion is built from what does move: the lecture pose is an
 * animation from the pool (default 「写代码」 — writing on a board), and each knowledge point is
 * broadcast into the bubble while it is being taught.
 *
 * @module dsh-unfold/lib/pet
 */
import { setTimeout as delay } from 'node:timers/promises';

/** dsh-pet route prefix. */
const PET_PREFIX = '/dsh-pet-7340';

/** Animations that read as "teaching", in order of preference. */
export const TEACHER_ANIMS = ['写代码', '轻快记录', '深度思考碎碎念', '原地敲击桌面互动'];

/** Bubble text cap: the pet bubble is a glance, not a paragraph. */
const MAX_TEXT = 160;

/** @type {Map<string, string>} origin → pet id */
const petIdCache = new Map();

/** POST/GET JSON with a short timeout; never throws. */
async function call(origin, path, init) {
  const url = `${origin.replace(/\/+$/, '')}${PET_PREFIX}${path}`;
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(6000),
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    // This API answers 200 for refusals too (`{ok:false, reason}`), so the body decides success —
    // except for the state tree, which is not a decision at all and carries no `ok`.
    const ok = json !== undefined && typeof json === 'object' ? json.ok !== false : res.ok;
    return { ok, status: res.status, json, text };
  } catch (error) {
    return { ok: false, status: 0, json: undefined, text: String(error?.message ?? error) };
  }
}

/**
 * The origin the pet is reachable at, waiting briefly for the web server to finish binding.
 * @param {{port?:number, getOrigin?:() => string}} webServer
 * @returns {Promise<string|undefined>}
 */
export async function petOrigin(webServer) {
  for (let i = 0; i < 12; i += 1) {
    try {
      const origin = typeof webServer?.getOrigin === 'function' ? webServer.getOrigin() : undefined;
      if (typeof origin === 'string' && origin.length > 0) return origin;
    } catch {
      /* getOrigin throws before the server is up */
    }
    const port = Number(webServer?.port ?? 0);
    if (Number.isFinite(port) && port > 0) return `http://127.0.0.1:${port}`;
    await delay(250);
  }
  return undefined;
}

/**
 * Which pet is on screen. Cached: it only changes when the user edits the config.
 * @param {string} origin
 * @returns {Promise<{petId:string, name?:string, display?:string}|undefined>}
 */
export async function discoverPet(origin) {
  const cached = petIdCache.get(origin);
  if (cached !== undefined) return { petId: cached };
  const res = await call(origin, '/state', { method: 'GET' });
  if (!res.ok || res.json === undefined) return undefined;
  const pets = res.json.pets;
  if (pets === undefined || typeof pets !== 'object') return undefined;
  const ids = Object.keys(pets);
  if (ids.length === 0) return undefined;
  // Prefer the pet that is shown on both surfaces, then the first one.
  const petId = ids.indexOf('main') >= 0 ? 'main' : ids[0];
  petIdCache.set(origin, petId);
  return { petId };
}

/** Query string shared by the interaction endpoints: which pet, which surface, and — while a lecture
 * holds the lock — the lock id. Everything except `/lock` itself is gated once the pet is locked, so
 * the id has to ride along on every call. */
function qs(petId, lockId, extra = {}) {
  const params = new URLSearchParams({ pet: petId, surface: 'any' });
  if (typeof lockId === 'string' && lockId.length > 0) params.set('lock', lockId);
  for (const [key, value] of Object.entries(extra)) if (value !== undefined) params.set(key, String(value));
  return params;
}

/**
 * Push a bubble.
 * @returns {Promise<{ok:boolean, reason?:string}>}
 */
export async function petBroadcast(origin, { petId, text, duration = 12000, anim, lockId }) {
  const body = String(text ?? '').trim().slice(0, MAX_TEXT);
  if (body.length === 0) return { ok: false, reason: 'empty' };
  const res = await call(origin, `/broadcast?${qs(petId, lockId)}`, {
    method: 'POST',
    body: JSON.stringify({ text: body, duration, anim: Boolean(anim) }),
  });
  if (res.ok) return { ok: true };
  const reason = res.json?.reason ?? res.json?.message ?? `HTTP ${res.status}`;
  if (String(reason).includes('pet-not-found')) petIdCache.delete(origin);
  return { ok: false, reason: String(reason) };
}

/** Play one animation from the pool. */
export async function petAnim(origin, { petId, name, facing, lockId }) {
  const payload = { name };
  if (facing === 'left' || facing === 'right') payload.facing = facing;
  const res = await call(origin, `/anim?${qs(petId, lockId)}`, { method: 'POST', body: JSON.stringify(payload) });
  return { ok: res.ok, reason: res.ok ? undefined : String(res.json?.reason ?? res.json?.message ?? res.status) };
}

/** Take the interaction lock, so random chatter cannot overwrite the lecture.
 *
 * Two modes on one endpoint: no `lockId` takes a new lock and the pet mints the id (2 min default
 * TTL, 30 min ceiling); passing the id renews it. A lecture renews on every beat, so the pet stays
 * ours for as long as we keep talking.
 */
export async function petLock(origin, { petId, lockId, ttl = 10 * 60 * 1000 }) {
  const q = new URLSearchParams({ pet: petId, surface: 'any' });
  const payload = { ttl };
  if (typeof lockId === 'string' && lockId.length > 0) payload.lockId = lockId;
  const res = await call(origin, `/lock?${q}`, { method: 'POST', body: JSON.stringify(payload) });
  return {
    ok: res.ok,
    lockId: typeof res.json?.lockId === 'string' ? res.json.lockId : undefined,
    reason: res.ok ? undefined : String(res.json?.reason ?? res.status),
  };
}

/** Release the lock (safe to call when we never held it). */
export async function petUnlock(origin, { petId, lockId }) {
  const res = await call(origin, `/lock/release?${qs(petId)}`, { method: 'POST', body: JSON.stringify({ lockId }) });
  return { ok: res.ok };
}

/** Clear the bubble. */
export async function petClearBubble(origin, { petId, lockId }) {
  const res = await call(origin, `/bubble/clear?${qs(petId, lockId)}`, { method: 'POST', body: '{}' });
  return { ok: res.ok };
}

/**
 * One teaching beat: say the point, and (throttled) strike the pose.
 *
 * @param {string} origin
 * @param {object} o
 * @param {string} o.petId
 * @param {string} o.text - the knowledge point
 * @param {string} [o.anim] - animation name from the pool
 * @param {number} [o.duration] - bubble lifetime in ms
 * @param {string} [o.lockId] - the lock this lecture holds
 */
export async function petTeach(origin, { petId, text, anim, duration, lockId }) {
  const said = await petBroadcast(origin, { petId, text, duration: duration ?? 12000, anim: false, lockId });
  if (!said.ok) return said;
  if (typeof anim === 'string' && anim.length > 0) {
    await petAnim(origin, { petId, name: anim, lockId });
  }
  return { ok: true };
}
