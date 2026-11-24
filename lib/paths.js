/**
 * Where unfold keeps its work: one folder per reading project under `<cwd>/.unfold/`.
 *
 * Layout of a project:
 *   .unfold/<slug>/project.json   what was ingested (docs, pages, title, goal)
 *   .unfold/<slug>/pages.json     per-page text + line boxes (build-time only, never shipped)
 *   .unfold/<slug>/pdf/<id>.pdf   a copy of the source PDF, so the note keeps working after the original moves
 *   .unfold/<slug>/notes.json     the note the model authored (re-buildable)
 *   .unfold/<slug>/notes.html     the deliverable: one offline file
 *   .unfold/<slug>/crops/*.png    page screenshots for citations (deleted after inlining)
 *
 * @module dsh-unfold/lib/paths
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** Folder name inside the workspace. */
export const ROOT_DIR = '.unfold';

/** Characters a slug may keep: ASCII word chars plus CJK. */
const KEEP = /[^\p{Script=Han}\p{L}\p{N}._-]+/gu;

/**
 * Resolve the workspace of the running session.
 * @param {unknown} exec - tool exec context (may carry the agent cwd)
 * @returns {string} absolute directory
 */
export function workspaceOf(exec) {
  const cwd = exec?.agent?.session?.header?.cwd;
  if (typeof cwd === 'string' && cwd.length > 0) return resolve(cwd);
  return process.cwd();
}

/**
 * Make a filesystem-safe, human-readable slug.
 * @param {string} name
 * @param {string} fallback
 * @returns {string}
 */
export function slugify(name, fallback = 'reading') {
  const raw = String(name ?? '').trim().replace(/\.pdf$/i, '');
  const cleaned = raw.replace(KEEP, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-');
  const slug = cleaned.slice(0, 48).toLowerCase();
  return slug.length > 0 ? slug : fallback;
}

/** Absolute path of the unfold root for a workspace. */
export function unfoldRoot(cwd) {
  return join(resolve(cwd), ROOT_DIR);
}

/** Absolute path of one project folder. */
export function projectDir(cwd, slug) {
  return join(unfoldRoot(cwd), slug);
}

/** Create a directory (recursive, idempotent). */
export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Read JSON, or undefined when the file is absent.
 * @param {string} file
 */
export async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return undefined;
  }
}

/** Write pretty JSON. */
export async function writeJson(file, value) {
  await writeFile(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

/** Whether a project folder looks like one. */
export function isProject(dir) {
  return existsSync(join(dir, 'project.json'));
}

/**
 * Every project under the workspace, newest first.
 * @param {string} cwd
 */
export async function listProjects(cwd) {
  const root = unfoldRoot(cwd);
  let names = [];
  try {
    names = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of names) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = join(root, entry.name);
    const project = await readJson(join(dir, 'project.json'));
    if (project === undefined) continue;
    out.push({
      slug: entry.name,
      dir,
      title: project.title ?? entry.name,
      docs: Array.isArray(project.docs) ? project.docs.length : 0,
      pages: Array.isArray(project.docs) ? project.docs.reduce((n, d) => n + (d.pages ?? 0), 0) : 0,
      hasNotes: existsSync(join(dir, 'notes.html')),
      builtAt: project.builtAt ?? null,
      updatedAt: project.updatedAt ?? null,
    });
  }
  out.sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
  return out;
}
