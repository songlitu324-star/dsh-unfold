/**
 * Host-mock smoke test: drive `apply()` with a fake cordis context and check what it registered.
 * This is the closest thing to a running host available in the sandbox (the real one needs a restart).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { apply, internals } from '../lib/index.js';

const CWD = 'C:\\Users\\tuson\\Desktop\\zy';
// The sandbox cannot write the real ~/.dsh, so the token registry gets a workspace home.
process.env.DSH_HOME = join(CWD, '.tmp', 'dshhome');
const tools = [];
const commands = [];
const routes = [];
const skillProviders = [];
const effects = [];

function fakeCtx() {
  const ctx = {
    logger: { info: () => {}, warn: (m) => console.log('[warn]', m) },
    effect(fn, label) {
      const dispose = fn();
      effects.push({ label, dispose });
      return dispose;
    },
    inject(deps, callback) {
      // Every service the plugin asks for exists in this mock.
      if (deps.includes('commands')) {
        callback({
          effect: (fn) => {
            const dispose = fn();
            effects.push({ label: 'commands', dispose });
            return dispose;
          },
          commands: {
            register(command) {
              commands.push(command);
              return () => {};
            },
          },
        });
      }
      if (deps.includes('webServer')) {
        const webServer = {
          port: 60248,
          getOrigin: () => 'http://127.0.0.1:60248',
          register(route) {
            routes.push(route);
            return () => {};
          },
        };
        callback({
          effect: (fn) => {
            const dispose = fn();
            effects.push({ label: 'web', dispose });
            return dispose;
          },
          webServer,
        });
      }
      if (deps.includes('skills')) {
        callback({
          effect: (fn) => {
            const dispose = fn();
            effects.push({ label: 'skills', dispose });
            return dispose;
          },
          skills: {
            registerProvider(factory) {
              skillProviders.push(factory({ invalidate: () => {} }));
              return () => {};
            },
          },
        });
      }
    },
  };
  ctx.tools = {
    register(tool) {
      tools.push(tool);
      return () => {};
    },
  };
  return ctx;
}

apply(fakeCtx(), {});

console.log('tools:', tools.map((t) => t.name).join(', '));
console.log('commands:', commands.map((c) => `/${c.name}`).join(', '));
console.log('routes:', routes.map((r) => `${r.kind} ${r.path}`).join(', '));
console.log('skill providers:', skillProviders.map((p) => p.name).join(', '));
console.log('effects:', effects.map((e) => e.label).join(', '));

// --- schema sanity: the registry wants展开的 JSON Schema, not author specs ---
for (const tool of tools) {
  const p = tool.parameters;
  const bad = Object.entries(p.properties ?? {}).filter(([, v]) => 'required' in v).map(([k]) => k);
  const assert = [];
  if (p.type !== 'object') assert.push('parameters.type !== object');
  if (p.additionalProperties !== false) assert.push('parameters.additionalProperties !== false');
  if (bad.length > 0) assert.push(`inline required left on: ${bad.join(',')}`);
  if (!tool.output?.schema || typeof tool.output.render !== 'function') assert.push('output missing');
  console.log(`  ${tool.name}: ${assert.length === 0 ? 'schema ok' : assert.join('; ')} + required=[${(p.required ?? []).join(',')}]`);
}

// --- skill provider ---
const provider = skillProviders[0];
const listed = await provider.list({});
console.log('skill list:', listed.map((c) => `${c.name} (${c.description.slice(0, 60)}…) rank=${c.rank}`).join('\n  '));
const got = await provider.get(listed[0], { signal: new AbortController().signal });
console.log('skill content starts:', JSON.stringify(got.content.slice(0, 80)));

// --- tools, in reading order ---
const exec = { agent: { session: { header: { cwd: CWD } } }, signal: new AbortController().signal };
const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

const status = await byName.unfold_status.execute({}, exec);
console.log('\n[status]\n' + status.text);

const read = await byName.unfold_read.execute({ project: 'attention', from: '2', to: '2' }, exec);
console.log('\n[read p.2]\n' + read.text.slice(0, 400) + '\n…');

const search = await byName.unfold_search.execute({ project: 'attention', query: 'attention mechanisms', limit: '3' }, exec);
console.log('\n[search]\n' + search.text);

const notes = readFileSync('C:\\Users\\tuson\\Desktop\\zy\\dsh-unfold\\dev\\demo-attention.json', 'utf8');
const built = await byName.unfold_build.execute({ project: 'attention', notes }, exec);
console.log('\n[build]\n' + built.text);

// --- bridge: token comes from project.json, the note uses it ---
const state = JSON.parse(readFileSync(join(CWD, '.unfold', 'attention', 'project.json'), 'utf8'));
const token = state.bridgeToken;
console.log('\nbridge token:', token ? `${token.slice(0, 6)}…` : '(none)');

function fakeReq(method, path, body) {
  const payload = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body), 'utf8');
  return {
    method,
    url: path,
    headers: { 'x-unfold-token': token },
    async *[Symbol.asyncIterator]() {
      if (payload.length > 0) yield payload;
    },
  };
}

function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: undefined,
    setHeader(k, v) {
      this.headers[k] = v;
    },
    end(chunk) {
      this.body = chunk;
    },
  };
}

const bridge = routes.find((r) => r.path === internals.BRIDGE_PREFIX);
console.log('bridge route handler:', typeof bridge?.handler);

for (const [method, path, body] of [
  ['GET', '/dsh-unfold/status', undefined],
  ['GET', '/dsh-unfold/voice', undefined],
  ['POST', '/dsh-unfold/tts', { text: '' }],
  ['POST', '/dsh-unfold/teach', { text: '注意力就是把查询和键做点积', duration: 5000 }],
  ['POST', '/dsh-unfold/say', { text: '测试' }],
  ['POST', '/dsh-unfold/stop', undefined],
  ['GET', '/dsh-unfold/nope', undefined],
]) {
  const res = fakeRes();
  // eslint-disable-next-line no-await-in-loop
  await bridge.handler(fakeReq(method, path, body), res);
  console.log(`  ${method} ${path} → ${res.statusCode} ${res.body}`);
}

// Bad token must be refused.
const res2 = fakeRes();
await bridge.handler({ ...fakeReq('POST', '/dsh-unfold/teach', { text: 'x' }), headers: { 'x-unfold-token': 'nope' } }, res2);
console.log(`  POST /teach (bad token) → ${res2.statusCode} ${res2.body}`);

// Playback of an unknown project must fail loudly rather than silently build nothing.
try {
  await byName.unfold_build.execute({ project: 'no-such-project', notes }, exec);
  console.log('unexpected: unknown project accepted');
} catch (error) {
  console.log('unknown project →', error.message);
}

// Disposal: every effect returns a function, and tools/commands unregister on unload.
console.log('effect disposers are functions:', effects.every((e) => typeof e.dispose === 'function'));

// The stand-in listener answers on the port baked into notes, not the host's port (60248 in the mock).
const localPort = internals.env.localPort;
for (const path of ['/status', '/voice']) {
  const res = await fetch(`http://127.0.0.1:${localPort}${path}`, { signal: AbortSignal.timeout(4000) });
  console.log(`  local :${localPort}${path} → ${res.status} ${(await res.text()).slice(0, 70)}`);
}
