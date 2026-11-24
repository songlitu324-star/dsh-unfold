/**
 * Ingest: PDF bytes → page text with line boxes, kept in the project so the note never has to
 * re-read the original files.
 *
 * What happens here is deliberately dumb and local: no upload, no model call, no summarising. The
 * reading itself (what matters, what to skip, what to say) is the agent's job and the skill's rules;
 * this module only makes sure the evidence is addressable afterwards.
 *
 * @module dsh-unfold/lib/ingest
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';
import { extractPages } from './pdf.js';
import { ensureDir, projectDir, readJson, slugify, writeJson } from './paths.js';

/** Largest PDF we accept, in bytes: beyond this the note's own assets get unwieldy. */
export const MAX_PDF_BYTES = 80 * 1024 * 1024;

/** Resolve a user-supplied path against the workspace. */
function resolveInput(cwd, file) {
  const path = isAbsolute(file) ? file : resolve(cwd, file);
  return existsSync(path) ? path : undefined;
}

/** Human title for a document: its own file name, minus the extension and the usual noise. */
function titleOf(file) {
  return basename(file, extname(file)).replace(/[_]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Add PDFs to a project (creating it when needed).
 *
 * @param {string} cwd - workspace root, where `.unfold/` lives
 * @param {object} options
 * @param {string[]} options.files - PDF paths (absolute, or relative to the workspace)
 * @param {string} [options.name] - project slug; defaults to the first file's name
 * @param {string} [options.title] - project title for the note cover
 * @param {string} [options.project] - existing project slug to append to
 * @returns {Promise<{slug:string, dir:string, title:string, added:any[], docs:any[], warnings:string[]}>}
 */
export async function ingest(cwd, { files, name, title, project }) {
  const given = (files ?? []).map((f) => String(f).trim()).filter((f) => f.length > 0);
  if (given.length === 0) throw new Error('没有给 PDF：请把文件路径放进 files');

  const slugs = [];
  const warnings = [];
  let dir;
  let state;
  let slug;

  if (typeof project === 'string' && project.trim() !== '') {
    slug = slugify(project);
    dir = projectDir(cwd, slug);
    if (!existsSync(join(dir, 'project.json'))) throw new Error(`找不到阅读项目「${slug}」（先 ingest 一次再往里加文件）`);
    state = await readJson(join(dir, 'project.json'));
  } else {
    slug = slugify(name ?? titleOf(given[0]));
    dir = projectDir(cwd, slug);
    state = existsSync(join(dir, 'project.json')) ? await readJson(join(dir, 'project.json')) : undefined;
    if (state === undefined) {
      state = {
        slug,
        title: title ?? titleOf(given[0]),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        docs: [],
      };
    }
  }

  await ensureDir(join(dir, 'pdf'));
  const pagesPath = join(dir, 'pages.json');
  const pagesFile = (await readJson(pagesPath)) ?? { docs: {} };
  const added = [];

  for (const file of given) {
    const path = resolveInput(cwd, file);
    if (path === undefined) {
      warnings.push(`跳过「${file}」：文件不存在`);
      continue;
    }
    if (extname(path).toLowerCase() !== '.pdf') {
      warnings.push(`跳过「${basename(path)}」：目前只吃 PDF`);
      continue;
    }
    const info = await stat(path);
    if (info.size > MAX_PDF_BYTES) {
      warnings.push(`跳过「${basename(path)}」：${Math.round(info.size / 1048576)}MB 超过 ${MAX_PDF_BYTES / 1048576}MB 上限`);
      continue;
    }
    const bytes = await readFile(path);
    const sha = createHash('sha1').update(bytes).digest('hex').slice(0, 10);
    const already = state.docs.find((d) => d.sha === sha);
    if (already !== undefined) {
      warnings.push(`「${basename(path)}」已经在项目里了（${already.id}）`);
      continue;
    }
    let extracted;
    try {
      extracted = await extractPages(new Uint8Array(bytes));
    } catch (error) {
      warnings.push(`跳过「${basename(path)}」：解析失败（${error instanceof Error ? error.message : String(error)}）`);
      continue;
    }
    const id = `p${state.docs.length + 1}`;
    const stored = join(dir, 'pdf', `${id}.pdf`);
    await copyFile(path, stored);
    pagesFile.docs[id] = { id, file: basename(path), pages: extracted.pages };
    const chars = extracted.pages.reduce((n, p) => n + p.lines.reduce((m, l) => m + l.t.length, 0), 0);
    const doc = {
      id,
      file: basename(path),
      title: titleOf(path),
      pages: extracted.numPages,
      chars,
      sha,
      bytes: info.size,
      addedAt: new Date().toISOString(),
    };
    state.docs.push(doc);
    added.push(doc);
    slugs.push(id);
  }

  if (added.length === 0) {
    return { slug, dir, title: state.title, added, docs: state.docs, warnings };
  }

  state.updatedAt = new Date().toISOString();
  await writeJson(pagesPath, { ...pagesFile, updatedAt: state.updatedAt });
  await writeJson(join(dir, 'project.json'), state);
  await writeFile(join(dir, '.gitignore'), 'pdf/\ncrops/\n.crops.*\npages.json\n', 'utf8');
  return { slug, dir, title: state.title, added, docs: state.docs, warnings };
}

/**
 * Read the stored pages of one document.
 * @param {string} dir - project folder
 * @param {string} docId
 */
export async function pagesOf(dir, docId) {
  const pagesFile = await readJson(join(dir, 'pages.json'));
  const doc = pagesFile?.docs?.[docId];
  if (doc === undefined) throw new Error(`项目里没有文档「${docId}」`);
  return doc;
}

/**
 * All documents of a project, with their stored pages.
 * @param {string} dir
 */
export async function allPages(dir) {
  const pagesFile = (await readJson(join(dir, 'pages.json'))) ?? { docs: {} };
  return pagesFile.docs ?? {};
}
