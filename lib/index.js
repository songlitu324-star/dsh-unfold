/**
 * dsh-unfold — unfold for DeepSeek Harness.
 *
 * The deliverable is not a viewer: it is the reading *process*. A skill teaches the agent how to take
 * a pile of PDFs and produce a lecture (probe first, shortest path, write only what is needed, then
 * teach it as it unfolds); five tools give it the hands to do so (import the PDFs, read the pages
 * back, search them, build the note, report status); and a small local bridge lets the finished note
 * drive the pet — lecture pose, knowledge point in the bubble — while the note is being taught.
 *
 * Everything runs on the user's machine. Importing and building never call a model; the only network
 * traffic this plugin ever causes is `127.0.0.1` → the pet's own routes, plus the speech synthesizer
 * when a note is read out loud (`/tts`, and only when someone presses play).
 *
 * @module dsh-unfold
 */
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './build.js';
import { probeRenderer } from './crops.js';
import { allPages, ingest } from './ingest.js';
import { listProjects, readJson, workspaceOf, writeJson } from './paths.js';
import { TEACHER_ANIMS, discoverPet, petBroadcast, petClearBubble, petLock, petOrigin, petTeach, petUnlock } from './pet.js';
import { DEFAULT_VOICE, VOICES, isVoiceId, probeTts, synthesize } from './tts.js';

export const name = 'dsh-unfold';

/**
 * `tools` is the one service the plugin cannot live without: registration happens in `apply`, so the
 * plugin must wait for it. Everything else (web server, slash commands, skills) is pulled in with
 * `ctx.inject` where it is used, so a host without any of them still gets the reading tools.
 */
export const inject = ['tools'];

/** Where the note's in-page bridge is mounted. */
const BRIDGE_PREFIX = '/dsh-unfold';

/** Skill folder, resolved at load so a packaged/hoisted install still finds it. */
const SKILL_DIR = fileURLToPath(new URL('../skills/unfold/', import.meta.url));

/** Runtime facts the tools need but only the host knows. */
const env = {
  /** Absolute base URL of this plugin's routes, once the web server is up. */
  origin: undefined,
  /** The pet we talk to, once `/state` answered. */
  petId: undefined,
  /** Last animation we fired: pool animations are one-shot, so re-fire them sparingly. */
  lastAnimAt: 0,
  /** Lock currently held on behalf of a lecturing note. */
  lockId: undefined,
  /** Which project owns that lock. */
  lockOwner: undefined,
  /** Bridge token → project, filled at build time (the note is a `file://` page and cannot say it). */
  bridgeDirs: new Map(),
  /** Last workspace a tool saw; the slash command has no `exec` to ask. */
  lastCwd: undefined,
  /** Port of the stand-in bridge listener, if it is up. The host's own port changes every launch,
   * so notes get this one instead — it is what keeps an old note working after a restart. */
  localPort: undefined,
};

/**
 * The tool registry takes JSON Schema (`required` is an array). Writing that by hand for five tools is
 * noise, so the author-facing shape here is "required: true inline" and this converts it once.
 *
 * @param {Record<string, object>} spec - parameter name → JSON Schema (plus optional `required: true`)
 * @returns {object} JSON Schema object
 */
function jsonSchema(spec) {
  const properties = {};
  const required = [];
  for (const [key, raw] of Object.entries(spec)) {
    const { required: isRequired, ...rest } = raw;
    properties[key] = rest;
    if (isRequired === true) required.push(key);
  }
  return { type: 'object', additionalProperties: false, properties, ...(required.length > 0 ? { required } : {}) };
}

/** Every tool answers in prose; project/path ride along so a UI card can offer them. */
const output = {
  schema: jsonSchema({
    text: { type: 'string', required: true },
    project: { type: 'string' },
    path: { type: 'string' },
  }),
  render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
};

/** Author-facing tool spec → registry tool. */
function adapt(tool) {
  return { ...tool, parameters: jsonSchema(tool.parameters) };
}

/** Human byte sizes. */
function kb(bytes) {
  if (!Number.isFinite(bytes)) return '?';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

/**
 * Resolve the project a tool call means: the named one, or the newest.
 *
 * @param {string} cwd
 * @param {string|undefined} project
 * @returns {Promise<{slug:string, dir:string, title?:string}>}
 */
async function pickProject(cwd, project) {
  const all = await listProjects(cwd);
  if (typeof project === 'string' && project.trim() !== '') {
    const wanted = project.trim();
    const hit = all.find((p) => p.slug === wanted || p.title === wanted);
    if (hit === undefined) {
      const known = all.map((p) => p.slug).join(', ') || '(none)';
      throw new Error(`No unfold project named "${wanted}". Existing: ${known}`);
    }
    return hit;
  }
  if (all.length === 0) throw new Error('No unfold project yet: import the PDFs with unfold_ingest first.');
  return all[0];
}

/**
 * Load the note JSON: inline text, an object, or a file (relative to the workspace).
 *
 * @param {string} cwd
 * @param {{notes?: unknown, notesFile?: string}} args
 */
async function loadNotes(cwd, { notes, notesFile }) {
  if (typeof notesFile === 'string' && notesFile.trim() !== '') {
    const path = isAbsolute(notesFile) ? notesFile : resolve(cwd, notesFile);
    if (!existsSync(path)) throw new Error(`Note file not found: ${path}`);
    const raw = await readFile(path, 'utf8');
    try {
      return { notes: JSON.parse(raw), from: path };
    } catch (error) {
      throw new Error(`Note file is not valid JSON (${path}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (notes !== undefined && notes !== null) {
    if (typeof notes === 'object') return { notes, from: 'inline' };
    const raw = String(notes).trim();
    if (raw.length === 0) throw new Error('notes is empty');
    try {
      return { notes: JSON.parse(raw), from: 'inline' };
    } catch (error) {
      throw new Error(`notes is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error('Pass either notes (a JSON string) or notesFile (a path).');
}

/**
 * CORS for the note → bridge calls. The note is opened from `file://`, so its origin is `null`.
 * Only `token` is accepted as a header: the note cannot read anything else back.
 */
function cors(res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type, x-unfold-token');
  res.setHeader('access-control-max-age', '600');
}

/** Read a JSON body with a hard cap (a note only ever sends a few hundred bytes). */
async function readJsonBody(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('body too large');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Send a JSON response. */
function sendJson(res, status, value) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(value));
}

/** Send binary bytes (synthesized speech). */
function sendBytes(res, status, body, contentType) {
  res.statusCode = status;
  res.setHeader('content-type', contentType);
  res.setHeader('content-length', String(body.length));
  res.setHeader('cache-control', 'no-store');
  res.end(body);
}

/**
 * A second, host-independent listener on a port we choose.
 *
 * A note is a static file; the URL baked into it has to keep working. The host's port is fresh on
 * every launch (a note built yesterday answers on nothing today), so the note talks to this instead
 * and the page never notices a restart. Binding fails harmlessly when the port is taken: we walk up a
 * dozen ports, and if none answers, builds fall back to the host route.
 *
 * @param {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>} handler
 * @param {number} firstPort
 * @returns {() => void} stop
 */
function listenLocal(handler, firstPort) {
  /** @type {import('node:http').Server[]} */
  const servers = [];
  let tries = 0;
  const listen = (port) => {
    const server = createServer((req, res) => {
      void handler(req, res).catch(() => {
        try {
          res.destroy();
        } catch {
          /* already gone */
        }
      });
    });
    servers.push(server);
    server.on('error', (error) => {
      if (/** @type {any} */ (error)?.code === 'EADDRINUSE' && tries < 12) {
        tries += 1;
        listen(port + 1);
      }
    });
    server.listen(port, '127.0.0.1', () => {
      env.localPort = port;
    });
    // Never a reason for the host process to stay alive on its own.
    server.unref?.();
  };
  listen(firstPort);
  return () => {
    for (const server of servers) {
      try {
        server.close();
      } catch {
        /* already closed */
      }
    }
    env.localPort = undefined;
  };
}

/**
 * The token that lets a note drive the pet: one per project, minted at build, embedded in the HTML.
 * A note opened months later still works; deleting the project revokes it by removing the file.
 *
 * @param {string} dir
 * @returns {Promise<string|undefined>}
 */
async function tokenOf(dir) {
  const state = await readJson(join(dir, 'project.json'));
  if (state === undefined) return undefined;
  if (typeof state.bridgeToken === 'string' && state.bridgeToken.length >= 8) return state.bridgeToken;
  const token = randomBytes(12).toString('hex');
  await writeJson(join(dir, 'project.json'), { ...state, bridgeToken: token });
  return token;
}

/** Where the token → project map survives a restart (the note outlives this process). */
const tokenRegistryPath = () => join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'dsh-unfold', 'bridge.json');

/** Remember that this token belongs to that project. Best effort: a failure only costs a 403 later. */
async function rememberToken(token, dir, slug) {
  try {
    const path = tokenRegistryPath();
    await mkdir(dirname(path), { recursive: true });
    let store = {};
    try {
      store = JSON.parse(await readFile(path, 'utf8'));
    } catch {
      store = {};
    }
    store[token] = { dir, slug, at: new Date().toISOString() };
    await writeFile(path, JSON.stringify(store, null, 2), 'utf8');
  } catch {
    /* the in-memory map still works for this run */
  }
}

/**
 * Which project a bridge call claims to come from. The note is a `file://` page, so the token is the
 * only thing it can prove; it is checked against the project's own `project.json` too, so a re-imported
 * project (new token) cannot be driven through an old note.
 *
 * @param {string} token
 * @returns {Promise<{dir:string, slug:string}|undefined>}
 */
async function projectOfToken(token) {
  if (typeof token !== 'string' || token.length < 8) return undefined;
  let hit = env.bridgeDirs.get(token);
  if (hit === undefined) {
    try {
      const store = JSON.parse(await readFile(tokenRegistryPath(), 'utf8'));
      hit = store[token];
    } catch {
      hit = undefined;
    }
  }
  if (hit === undefined) return undefined;
  const state = await readJson(join(hit.dir, 'project.json'));
  if (state?.bridgeToken !== token) return undefined;
  env.bridgeDirs.set(token, hit);
  return hit;
}

/** Discover the pet once; `undefined` means "no pet".
 *
 * @returns {Promise<string|undefined>} pet id
 */
async function ensurePet() {
  if (env.origin === undefined) return undefined;
  if (env.petId !== undefined) return env.petId;
  const found = await discoverPet(env.origin);
  if (found !== undefined) env.petId = found.petId;
  return env.petId;
}

/**
 * Take (or renew) the pet's interaction lock for a lecture. With the lock held, random chatter and
 * picker animations stay out of the way, so the lecture owns the pet until it stops. The pet mints the
 * lock id; recycling it on every beat renews the TTL, so a long lecture never loses the pet.
 *
 * @param {string} owner - project slug
 */
async function takeLock(owner) {
  const petId = await ensurePet();
  if (petId === undefined || env.origin === undefined) return { ok: false, reason: 'no pet' };
  const res = await petLock(env.origin, { petId, lockId: env.lockId });
  if (res.ok && res.lockId !== undefined) {
    env.lockId = res.lockId;
    env.lockOwner = owner;
    return { ok: true, lockId: res.lockId };
  }
  // `lock-lost`: our lock expired or was taken. Drop the id so the next beat takes a fresh one.
  if (res.reason === 'lock-lost' || res.reason === 'locked') env.lockId = undefined;
  return { ok: false, reason: res.reason };
}

/** Stop teaching: clear our bubble while we still hold the lock, then hand the pet back. */
async function releaseLock() {
  const petId = await ensurePet();
  if (petId === undefined || env.origin === undefined) return;
  const lockId = env.lockId;
  await petClearBubble(env.origin, { petId, lockId });
  env.lockId = undefined;
  env.lockOwner = undefined;
  if (lockId !== undefined) await petUnlock(env.origin, { petId, lockId });
}

/**
 * @param {any} ctx - cordis plugin context
 * @param {{teacherAnim?: string, ttsVoice?: string, bridgePort?: number}} [config]
 */
export function apply(ctx, config = {}) {
  const defaultAnim =
    typeof config.teacherAnim === 'string' && config.teacherAnim.length > 0 ? config.teacherAnim : TEACHER_ANIMS[0];
  // Which voice the lecture is read in. Any Edge voice id is allowed, not just the menu's.
  const defaultVoice = isVoiceId(config.ttsVoice) ? config.ttsVoice : DEFAULT_VOICE;
  // Fixed port for the note bridge. Never the host's own port: that one moves with every launch.
  const bridgePort = Number.isFinite(Number(config.bridgePort)) && Number(config.bridgePort) > 0 ? Number(config.bridgePort) : 51230;

  /* ---------------- tools ---------------- */

  /** The tools belong to this plugin: keep their disposers so an unload takes all of them. */
  const toolDisposers = [];
  const registerTool = (tool) => {
    toolDisposers.push(ctx.tools.register(adapt(tool)));
  };
  ctx.effect(
    () => () => {
      for (const dispose of toolDisposers.splice(0)) {
        try {
          dispose?.();
        } catch {
          /* already gone */
        }
      }
    },
    'unfold:tools',
  );

  registerTool({
    name: 'unfold_ingest',
    description:
      'Import the PDFs a user wants to understand into an unfold reading project. Extracts the text layer with line boxes (local, no model call) and keeps a copy of each PDF, so the finished note can show the original page for every citation. One call is one project; call again with `project` to add more PDFs to it.',
    parameters: {
      files: {
        type: 'array',
        items: { type: 'string' },
        required: true,
        description: 'PDF paths, absolute or relative to the workspace.',
      },
      title: { type: 'string', description: 'Project title, shown on the note cover. Defaults to the first file name.' },
      project: { type: 'string', description: 'Existing project slug to append to, instead of creating a new one.' },
      name: { type: 'string', description: 'Slug for a new project. Defaults to a slug of the title.' },
    },
    output,
    isConcurrencySafe: () => true,
    timeoutMs: 300_000,
    async execute(args, exec) {
      const cwd = workspaceOf(exec);
      env.lastCwd = cwd;
      const result = await ingest(cwd, { files: args.files, title: args.title, project: args.project, name: args.name });
      const lines = [];
      if (result.added.length === 0) {
        lines.push(`Nothing new imported (project "${result.slug}" is unchanged).`);
        for (const warning of result.warnings) lines.push(`- ${warning}`);
      } else {
        lines.push(`Imported ${result.added.length} document(s) into "${result.slug}":`);
        for (const doc of result.added) {
          lines.push(`- ${doc.id} · ${doc.file} · ${doc.pages} pages · ~${doc.chars} chars`);
        }
        if (result.warnings.length > 0) {
          lines.push('');
          for (const warning of result.warnings) lines.push(`- ${warning}`);
        }
        lines.push('');
        lines.push(
          `Pages and boxes are stored in ${result.dir}. Read them with unfold_read / unfold_search, then write the note.`,
        );
      }
      return { text: lines.join('\n'), project: result.slug, path: result.dir };
    },
    presentCall: (args) => ({ card: 'generic', title: `Import PDFs: ${(args.files ?? []).length}`, kind: 'fetch' }),
  });

  registerTool({
    name: 'unfold_read',
    description:
      'Read pages back out of an unfold project, with page numbers. Use it while writing the note so every claim can be tied to a page. Cheaper than re-parsing the PDF: the text layer is already stored, with line breaks preserved.',
    parameters: {
      project: { type: 'string', description: 'Project slug. Defaults to the newest project.' },
      doc: { type: 'string', description: 'Document id such as p1. Defaults to every document.' },
      from: { type: 'string', description: 'First page, 1-based. Defaults to 1.' },
      to: { type: 'string', description: 'Last page, inclusive. Defaults to from + 2.' },
    },
    output,
    isConcurrencySafe: () => true,
    timeoutMs: 60_000,
    async execute(args, exec) {
      const cwd = workspaceOf(exec);
      env.lastCwd = cwd;
      const project = await pickProject(cwd, args.project);
      const stored = await allPages(project.dir);
      const from = Math.max(1, Number.parseInt(String(args.from ?? '1'), 10) || 1);
      const to = Math.max(from, Number.parseInt(String(args.to ?? String(from + 2)), 10) || from + 2);
      const docs = typeof args.doc === 'string' && args.doc.trim() !== '' ? [args.doc.trim()] : Object.keys(stored);
      const out = [];
      let shown = 0;
      for (const docId of docs) {
        const doc = stored[docId];
        if (doc === undefined) {
          out.push(`[${docId}] is not part of this project`);
          continue;
        }
        for (const page of doc.pages) {
          if (page.n < from || page.n > to) continue;
          if (shown === 0) out.push(`=== ${docId} · ${doc.file} (${doc.pages.length} pages) ===`);
          out.push(`--- p.${page.n} (${Math.round(page.w)}x${Math.round(page.h)}) ---`);
          out.push(page.lines.map((line) => line.t).join('\n'));
          shown += 1;
        }
      }
      if (shown === 0) out.push(`No pages in ${from}..${to}. Ask unfold_status for the page counts.`);
      const text = out.join('\n');
      return {
        text: text.length > 24000 ? `${text.slice(0, 24000)}\n…(truncated — read a smaller page range)` : text,
        project: project.slug,
      };
    },
    presentCall: (args) => ({ card: 'generic', title: `Read pages ${args.from ?? 1}–${args.to ?? '…'}`, kind: 'read' }),
  });

  registerTool({
    name: 'unfold_search',
    description:
      'Search the stored text of an unfold project and get page-accurate hits (page number + the line). Use it to find the exact sentence to quote: a citation carries a page and a quote, and a quote that is not on its page cannot be shown as a screenshot.',
    parameters: {
      query: { type: 'string', required: true, description: 'Case-insensitive substring to look for.' },
      project: { type: 'string', description: 'Project slug. Defaults to the newest project.' },
      doc: { type: 'string', description: 'Restrict to one document id.' },
      limit: { type: 'string', description: 'Max hits, default 12, max 40.' },
    },
    output,
    isConcurrencySafe: () => true,
    timeoutMs: 60_000,
    async execute(args, exec) {
      const cwd = workspaceOf(exec);
      env.lastCwd = cwd;
      const project = await pickProject(cwd, args.project);
      const stored = await allPages(project.dir);
      const needle = String(args.query ?? '').toLowerCase().trim();
      if (needle.length === 0) throw new Error('query is empty');
      const limit = Math.min(40, Math.max(1, Number.parseInt(String(args.limit ?? '12'), 10) || 12));
      const docs = typeof args.doc === 'string' && args.doc.trim() !== '' ? [args.doc.trim()] : Object.keys(stored);
      const hits = [];
      for (const docId of docs) {
        const doc = stored[docId];
        if (doc === undefined) continue;
        for (const page of doc.pages) {
          for (const line of page.lines) {
            if (!line.t.toLowerCase().includes(needle)) continue;
            hits.push(`${docId} p.${page.n}: ${line.t}`);
            if (hits.length >= limit) break;
          }
          if (hits.length >= limit) break;
        }
        if (hits.length >= limit) break;
      }
      const text =
        hits.length === 0
          ? `No line contains "${args.query}". Try a shorter word, or the document's own language.`
          : `${hits.length} hit(s) (max ${limit}):\n${hits.join('\n')}`;
      return { text, project: project.slug };
    },
    presentCall: (args) => ({ card: 'generic', title: `Search: ${String(args.query ?? '').slice(0, 40)}`, kind: 'search' }),
  });

  registerTool({
    name: 'unfold_build',
    description:
      'Assemble the deliverable: one offline HTML lecture, with every citation resolved to a screenshot of the original page. This does not build the understanding — that is the unfold skill\'s job. Pass the note as notesFile (a JSON file) or notes (a JSON string); the structure is in the skill\'s references/notes-schema.md.',
    parameters: {
      project: { type: 'string', description: 'Project slug from unfold_ingest.' },
      notesFile: { type: 'string', description: 'Path to a JSON file with the note (relative to the workspace).' },
      notes: { type: 'string', description: 'The note as a JSON string, if you did not write a file.' },
      pet: { type: 'string', description: 'Pass "off" to build without embedding the pet bridge URL.' },
    },
    output,
    isConcurrencySafe: () => true,
    timeoutMs: 300_000,
    async execute(args, exec) {
      const cwd = workspaceOf(exec);
      env.lastCwd = cwd;
      const project = await pickProject(cwd, args.project);
      const { notes, from } = await loadNotes(cwd, args);
      const token = await tokenOf(project.dir);
      // The note outlives this process: the host's port is fresh on every launch, so point the page at
      // the stand-in listener when it is up, and only fall back to the host route when it is not.
      const base = env.localPort !== undefined ? `http://127.0.0.1:${env.localPort}` : `${env.origin ?? ''}${BRIDGE_PREFIX}`;
      const bridge =
        args.pet === 'off' || base.length === 0 || token === undefined
          ? undefined
          : // The note appends `/teach` and `/stop`, so the base is the mount point itself.
            { url: base, token };
      const report = await build({
        cwd,
        project: project.slug,
        notes,
        bridge,
        tts: bridge === undefined ? undefined : { voice: defaultVoice, voices: VOICES },
      });
      if (token !== undefined && bridge !== undefined) {
        env.bridgeDirs.set(token, { dir: project.dir, slug: project.slug });
        await rememberToken(token, project.dir, project.slug);
      }
      const lines = [
        `Lecture built: ${report.path}`,
        `- ${report.sections} section(s), ${report.blocks} block(s), ${report.beats} teaching beat(s)`,
        `- ${kb(report.bytes)}, open it by double-clicking — no network needed`,
      ];
      const citeLine = [`- ${report.citations} citation(s)`, `resolved ${report.resolved}`];
      if (report.noQuote > 0) citeLine.push(`pointer-only ${report.noQuote}`);
      if (report.notFound > 0) citeLine.push(`NOT found ${report.notFound}`);
      lines.push(citeLine.join(', '));
      if (report.images > 0) lines.push(`- ${report.images} page screenshot(s) inlined, ${kb(report.imageBytes)}`);
      if (report.notFound > 0) {
        lines.push(
          `- ${report.notFound} quote(s) do not appear on their page: run unfold_search to copy the exact sentence, then rebuild`,
        );
      }
      if (report.rendererNote !== undefined) {
        lines.push(`- page screenshots unavailable (${report.rendererNote}): citations show the quote only`);
      }
      lines.push(`- note source: ${from}`);
      return { text: lines.join('\n'), project: project.slug, path: report.path };
    },
    presentCall: () => ({ card: 'generic', title: 'Build the lecture HTML', kind: 'execute' }),
  });

  registerTool({
    name: 'unfold_status',
    description:
      'What unfold has in this workspace: reading projects and their state, whether page-screenshot rendering works, and whether the pet bridge (teacher mode) is reachable.',
    parameters: {},
    output,
    isConcurrencySafe: () => true,
    timeoutMs: 30_000,
    async execute(_args, exec) {
      const cwd = workspaceOf(exec);
      env.lastCwd = cwd;
      const projects = await listProjects(cwd);
      const renderer = await probeRenderer();
      const petId = await ensurePet();
      const lines = [];
      if (projects.length === 0) {
        lines.push('No reading project yet. Hand me some PDFs and ask me to teach them.');
      } else {
        lines.push(`Reading projects (${projects.length}):`);
        for (const p of projects) {
          lines.push(
            `- ${p.slug} · "${p.title}" · ${p.docs} doc(s) / ${p.pages} page(s) · ${p.hasNotes ? 'lecture built' : 'no lecture yet'}`,
          );
        }
      }
      lines.push('');
      lines.push(`Page screenshots: ${renderer.ok ? 'available' : `unavailable (${renderer.reason})`}`);
      lines.push(
        `Pet bridge: ${petId === undefined ? 'no pet found (notes still work, just without the bubble)' : `available (pet=${petId})`}`,
      );
      return { text: lines.join('\n') };
    },
    presentCall: () => ({ card: 'generic', title: 'unfold status', kind: 'read' }),
  });

  /* ---------------- slash command ---------------- */

  ctx.inject(['commands'], (commandsCtx) => {
    commandsCtx.effect(
      () =>
        commandsCtx.commands.register({
          name: 'unfold',
          description: 'unfold reading projects, lectures and pet pairing',
          input: { hint: '[list]' },
          handler: async () => {
            const cwd = env.lastCwd;
            if (cwd === undefined) {
              return {
                kind: 'success',
                text: 'No workspace seen yet this session. Ask the agent "读一下这些 PDF" — the tools pick up the workspace themselves.',
              };
            }
            const projects = await listProjects(cwd);
            if (projects.length === 0) {
              return { kind: 'success', text: 'No reading project in this workspace yet.' };
            }
            const rows = projects.map(
              (p) => `${p.slug} · "${p.title}" · ${p.docs} doc(s) / ${p.pages} page(s)${p.hasNotes ? ' · lecture built' : ''}`,
            );
            return { kind: 'success', text: `Reading projects in ${cwd}:\n${rows.join('\n')}` };
          },
        }),
      'unfold:command',
    );
  });

  /* ---------------- HTTP bridge (note → pet) ---------------- */

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => {
      const handler = async (req, res) => {
          cors(res);
          if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            res.end();
            return;
          }
          const url = new URL(req.url ?? '/', 'http://127.0.0.1');
          // Two mounts share this handler: the host route under BRIDGE_PREFIX, and the stand-in
          // listener at the root. Strip the prefix only when it is actually there.
          const rest = url.pathname.startsWith(BRIDGE_PREFIX)
            ? url.pathname.slice(BRIDGE_PREFIX.length) || '/'
            : url.pathname || '/';
          try {
            if (rest === '/status' && req.method === 'GET') {
              const petId = await ensurePet();
              sendJson(res, 200, {
                ok: true,
                petId: petId ?? null,
                teacherAnim: defaultAnim,
                lockId: env.lockId ?? null,
                origin: env.origin ?? null,
                localPort: env.localPort ?? null,
              });
              return;
            }
            // The voice menu and the default voice: enough for a page (or a script) to offer a picker
            // without being told at build time. No token: it is a catalogue, not an action.
            if (rest === '/voice' && req.method === 'GET') {
              const engine = await probeTts();
              sendJson(res, 200, { ok: true, default: defaultVoice, voices: VOICES, engine });
              return;
            }
            const KNOWN = new Set(['/teach', '/say', '/stop', '/tts']);
            if (req.method !== 'POST' || !KNOWN.has(rest)) {
              sendJson(res, KNOWN.has(rest) ? 405 : 404, {
                ok: false,
                reason: KNOWN.has(rest) ? 'method-not-allowed' : 'not-found',
              });
              return;
            }
            const body = await readJsonBody(req);
            if (body === undefined) {
              sendJson(res, 400, { ok: false, reason: 'invalid-json' });
              return;
            }
            const project = await projectOfToken(req.headers['x-unfold-token']);
            if (project === undefined) {
              sendJson(res, 403, { ok: false, reason: 'bad-token' });
              return;
            }

            if (rest === '/teach') {
              const text = String(body.text ?? '').trim();
              if (text.length === 0) {
                sendJson(res, 400, { ok: false, reason: 'empty-text' });
                return;
              }
              const petId = await ensurePet();
              if (petId === undefined || env.origin === undefined) {
                sendJson(res, 200, { ok: false, reason: 'no-pet' });
                return;
              }
              const lock = await takeLock(project.slug);
              // The pose is a one-shot animation: re-fire it only every few seconds, or the pet
              // restarts it mid-gesture and looks stuck.
              const asked = typeof body.anim === 'string' && body.anim.length > 0 ? body.anim : undefined;
              const anim = asked ?? (Date.now() - env.lastAnimAt > 8000 ? defaultAnim : undefined);
              if (anim !== undefined) env.lastAnimAt = Date.now();
              const said = await petTeach(env.origin, {
                petId,
                text,
                anim,
                lockId: lock.ok ? env.lockId : undefined,
                duration: Math.min(60_000, Math.max(4000, Number(body.duration ?? 0) || 12000)),
              });
              sendJson(res, 200, { ok: said.ok, reason: said.reason, petId, lock: lock.ok });
              return;
            }
            if (rest === '/tts') {
              const spoken = String(body.text ?? '').trim().slice(0, 1200);
              if (spoken.length === 0) {
                sendJson(res, 400, { ok: false, reason: 'empty-text' });
                return;
              }
              const voice = isVoiceId(body.voice) ? body.voice : defaultVoice;
              // A note that skips a beat cancels its request; do not keep synthesizing into the void.
              const abort = new AbortController();
              res.on('close', () => abort.abort());
              try {
                const audio = await synthesize({
                  text: spoken,
                  voice,
                  rate: typeof body.rate === 'number' ? body.rate : String(body.rate ?? ''),
                  signal: abort.signal,
                });
                sendBytes(res, 200, audio, 'audio/mpeg');
              } catch (error) {
                sendJson(res, 502, {
                  ok: false,
                  reason: 'tts-unavailable',
                  message: error instanceof Error ? error.message : String(error),
                });
              }
              return;
            }
            if (rest === '/stop') {
              await releaseLock();
              sendJson(res, 200, { ok: true });
              return;
            }
            if (rest === '/say') {
              const petId = await ensurePet();
              if (petId === undefined || env.origin === undefined) {
                sendJson(res, 200, { ok: false, reason: 'no-pet' });
                return;
              }
              const said = await petBroadcast(env.origin, { petId, text: String(body.text ?? ''), duration: 12000 });
              sendJson(res, 200, { ok: said.ok, reason: said.reason, petId });
              return;
            }
            sendJson(res, 404, { ok: false, reason: 'not-found' });
          } catch (error) {
            ctx.logger?.warn?.(`unfold bridge: ${error instanceof Error ? error.message : String(error)}`);
            try {
              sendJson(res, 500, { ok: false, reason: 'bridge-error' });
            } catch {
              /* the response was already written */
            }
          }
      };
      const dispose = webCtx.webServer.register({ kind: 'prefix', path: BRIDGE_PREFIX, handler });
      const stopLocal = listenLocal(handler, bridgePort);
      return () => {
        stopLocal();
        if (typeof dispose === 'function') dispose();
      };
    }, 'unfold:bridge');

    // The origin only exists once the server is listening.
    webCtx.effect(() => {
      let cancelled = false;
      void (async () => {
        const origin = await petOrigin(webCtx.webServer);
        if (cancelled || origin === undefined) return;
        env.origin = origin;
        env.petId = undefined;
      })();
      return () => {
        cancelled = true;
        env.origin = undefined;
        env.petId = undefined;
        env.lockId = undefined;
      };
    }, 'unfold:origin');
  });

  /* ---------------- skill ---------------- */

  ctx.inject(['skills'], (skillCtx) => {
    skillCtx.effect(() => {
      const file = join(SKILL_DIR, 'SKILL.md');
      const provider = {
        name: 'unfold',
        async list() {
          const raw = await readFile(file, 'utf8');
          const description =
            /^description:\s*(.+)$/m.exec(raw)?.[1]?.trim() ?? 'unfold: turn a pile of PDFs into a lecture you can sit through';
          return [
            {
              name: 'unfold',
              description,
              invocation: { modelInvocable: true, userInvocable: true },
              provider: 'unfold',
              source: 'bundled',
              resourceBase: { kind: 'directory', path: SKILL_DIR },
              path: file,
              rank: 40,
              locator: file,
            },
          ];
        },
        async get(candidate) {
          const target = typeof candidate?.locator === 'string' ? candidate.locator : file;
          const raw = await readFile(target, 'utf8');
          const description = /^description:\s*(.+)$/m.exec(raw)?.[1]?.trim() ?? 'unfold';
          const content = raw.replace(/^---[\s\S]*?---\s*/, '');
          return { ...candidate, description, content };
        },
      };
      const dispose = skillCtx.skills.registerProvider(() => provider);
      return () => dispose();
    }, 'unfold:skill');
  });

  ctx.logger?.info?.('unfold: ready (ingest → read → build → lecture, pet bridge on demand)');
}

/** Exported for tests: the parts worth checking without a host. */
export const internals = { BRIDGE_PREFIX, env, TEACHER_ANIMS, jsonSchema, adapt };
