/**
 * Build: notes (authored by the agent) → one offline HTML file.
 *
 * The note is the product. It has to work when the browser is offline, when the PDFs are gone and
 * when the plugin is uninstalled, so every citation's page screenshot is inlined as a data URI and
 * the page has no external request of any kind (except the optional local pet bridge, which is
 * wrapped in a try/catch and simply never fires when DSH is not running).
 *
 * @module dsh-unfold/lib/build
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { allPages } from './ingest.js';
import { renderCrops } from './crops.js';
import { projectDir, writeJson } from './paths.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(HERE, '..', 'assets', 'notes.template.html');

/** Lowercase + strip every space, so a quote survives line breaks, hyphenation and PDF quirks. */
export function squash(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[­​‍﻿]/g, '')
    .replace(/\s+/g, '')
    // A line break inside a word arrives as "transduc-" + "tion"; the hyphen is the PDF's, not the word's.
    .replace(/-/g, '')
    .replace(/[“”"'’‘]/g, '');
}

/** Inline math and subscripts come out as their own tiny lines; they break quote continuity and are
 *  inside the paragraph's box anyway, so the search skips them. */
export function isNoise(line) {
  return line.w < 40 && line.t.length < 12;
}

/** Keep the JSON safe inside <script>. */
function jsonForHtml(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
}

/** Clamp a number. */
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/**
 * Locate a quote on a page and return the box that covers it.
 *
 * Matching is done on whitespace-free text: PDF lines wrap mid-sentence, and a quote copied out of
 * the page will contain the reader's newlines, not the PDF's. Lines are consumed in reading order
 * until the quote is covered; a quote that cannot be found returns null and the note falls back to
 * showing the text only.
 *
 * @param {{t:string,x:number,y:number,w:number,h:number}[]} lines
 * @param {string} quote
 * @returns {{x:number,y:number,w:number,h:number}|null}
 */
export function boxOfQuote(lines, quote) {
  const target = squash(quote);
  if (target.length < 4) return null;
  const usable = lines.filter((line) => !isNoise(line));
  if (usable.length === 0) return null;

  const squashed = usable.map((line) => squash(line.t));
  const text = squashed.join('');
  const at = text.indexOf(target);
  if (at < 0) return null;

  let offset = 0;
  let startLine = -1;
  let endLine = -1;
  for (let i = 0; i < squashed.length; i += 1) {
    const from = offset;
    const to = offset + squashed[i].length;
    if (startLine < 0 && at < to) startLine = i;
    if (at + target.length - 1 < to) {
      endLine = i;
      break;
    }
    offset = to;
  }
  if (startLine < 0 || endLine < 0) return null;

  let box = null;
  for (let i = startLine; i <= endLine; i += 1) {
    const line = usable[i];
    box =
      box === null
        ? { x: line.x, y: line.y, w: line.w, h: line.h }
        : {
            x: Math.min(box.x, line.x),
            y: Math.min(box.y, line.y),
            w: Math.max(box.x + box.w, line.x + line.w) - Math.min(box.x, line.x),
            h: Math.max(box.y + box.h, line.y + line.h) - Math.min(box.y, line.y),
          };
  }
  return box;
}

/** Give every section/block a stable id, so the lecture script and the outline can address them. */
function normalizeNotes(raw, state) {
  const docs = new Map();
  for (const doc of state.docs ?? []) docs.set(doc.id, doc);
  const sections = [];
  let blockCount = 0;

  (raw.sections ?? []).forEach((section, si) => {
    const id = String(section.id ?? `s${si + 1}`);
    const blocks = [];
    for (const block of section.blocks ?? []) {
      blockCount += 1;
      const bid = String(block.id ?? `b${blockCount}`);
      const cites = (block.cites ?? [])
        .map((cite) => {
          const docId = String(cite.doc ?? '');
          const doc = docs.get(docId);
          if (doc === undefined) return undefined;
          const page = clamp(Number(cite.page ?? 1) || 1, 1, Math.max(1, doc.pages));
          return {
            doc: docId,
            page,
            quote: String(cite.quote ?? '').trim(),
            label: cite.label === undefined ? undefined : String(cite.label),
          };
        })
        .filter(Boolean);
      blocks.push({
        id: bid,
        kind: String(block.kind ?? 'p'),
        md: String(block.md ?? ''),
        note: block.note === undefined ? undefined : String(block.note),
        cites,
      });
    }
    sections.push({
      id,
      level: clamp(Number(section.level ?? 1) || 1, 1, 4),
      title: String(section.title ?? ''),
      summary: section.summary === undefined ? undefined : String(section.summary),
      blocks,
    });
  });

  const blockIds = new Set(sections.flatMap((s) => s.blocks.map((b) => b.id)));
  const lecture = (raw.lecture ?? [])
    .map((beat) => {
      const block = String(beat.block ?? '');
      if (!blockIds.has(block)) return undefined;
      return {
        block,
        say: String(beat.say ?? '').trim(),
        anim: beat.anim === undefined ? undefined : String(beat.anim),
        point: beat.point === true,
      };
    })
    .filter(Boolean);

  return {
    title: String(raw.title ?? state.title ?? '笔记'),
    subtitle: raw.subtitle === undefined ? undefined : String(raw.subtitle),
    goal: raw.goal === undefined ? undefined : String(raw.goal),
    start: raw.start === undefined ? undefined : String(raw.start),
    path: Array.isArray(raw.path)
      ? raw.path.map((p) => ({
          title: String(p?.title ?? ''),
          why: p?.why === undefined ? undefined : String(p.why),
        }))
      : [],
    sections,
    lecture,
    quiz: Array.isArray(raw.quiz)
      ? raw.quiz.map((q) => ({ q: String(q?.q ?? ''), a: String(q?.a ?? '') }))
      : [],
    docs: (state.docs ?? []).map((d) => ({ id: d.id, title: d.title, file: d.file, pages: d.pages })),
  };
}

/**
 * Build the note file of a project.
 *
 * @param {object} options
 * @param {string} options.cwd - workspace (where `.unfold/` lives)
 * @param {string} options.project - project slug
 * @param {object} options.notes - the note, see skills/unfold/references/notes-schema.md
 * @param {{url:string, token:string}} [options.bridge] - the pet bridge this note is allowed to call
 * @param {{voice?:string, voices?:object[]}} [options.tts] - speech: default voice and the menu
 * @returns {Promise<object>} build report
 */
export async function build({ cwd, project, notes, bridge, tts }) {
  const dir = projectDir(cwd, project);
  let state;
  try {
    state = JSON.parse(await readFile(join(dir, 'project.json'), 'utf8'));
  } catch {
    throw new Error(`找不到阅读项目「${project}」（先 unfold_ingest 导入 PDF）`);
  }

  const normalized = normalizeNotes(notes ?? {}, state);
  if (normalized.sections.length === 0) throw new Error('笔记里没有任何 section：至少写一节');

  const stored = await allPages(dir);
  const crops = [];
  const cropRequests = [];
  const seen = new Map();
  let cites = 0;
  let resolved = 0;
  let noQuote = 0;
  let notFound = 0;

  for (const section of normalized.sections) {
    for (const block of section.blocks) {
      for (const cite of block.cites) {
        cites += 1;
        const doc = stored[cite.doc];
        const page = doc?.pages?.find((p) => p.n === cite.page);
        if (page === undefined) {
          notFound += 1;
          continue;
        }
        if (cite.quote.length === 0) {
          // A pointer citation ("see p.3") is legitimate: there is just nothing to screenshot.
          noQuote += 1;
          cite.crop = undefined;
          continue;
        }
        const box = boxOfQuote(page.lines, cite.quote);
        if (box === null) {
          notFound += 1;
          cite.crop = undefined;
          continue;
        }
        resolved += 1;
        // A little air around the glyphs: the reported line height is the em box, and real ascenders
        // poke out of it. The top gets less air than the bottom on purpose — the line above hangs its
        // descenders into that gap, and a crop that starts with half a stranger's letters looks broken.
        const padX = 6;
        const padTop = 1;
        const padBottom = 3;
        const rect = {
          x: Math.max(0, box.x - padX),
          y: Math.max(0, box.y - padTop),
          w: Math.min(page.w, box.x + box.w + padX) - Math.max(0, box.x - padX),
          h: Math.min(page.h, box.y + box.h + padBottom) - Math.max(0, box.y - padTop),
        };
        const key = `${cite.doc}:${cite.page}:${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.w)},${Math.round(rect.h)}`;
        let index = seen.get(key);
        if (index === undefined) {
          index = crops.length;
          seen.set(key, index);
          crops.push({
            id: `c${index + 1}`,
            doc: cite.doc,
            page: cite.page,
            rect,
            quote: cite.quote,
            label: cite.label,
            png: undefined,
            w: undefined,
            h: undefined,
          });
          cropRequests.push({
            id: `c${index + 1}`,
            pdf: join(dir, 'pdf', `${cite.doc}.pdf`),
            page: cite.page,
            rect,
            pad: 0,
          });
        }
        cite.crop = index;
      }
    }
  }

  let rendererNote;
  if (cropRequests.length > 0) {
    const rendered = await renderCrops({ dir, requests: cropRequests });
    if (rendered.ok) {
      for (const crop of crops) {
        const hit = rendered.crops[crop.id];
        if (hit !== undefined) {
          crop.png = hit.png;
          crop.w = hit.w;
          crop.h = hit.h;
        }
      }
    } else {
      rendererNote = rendered.reason ?? 'renderer unavailable';
    }
  }

  const images = crops.filter((c) => c.png !== undefined);
  const payload = {
    ...normalized,
    builtAt: new Date().toISOString(),
    bridge: bridge !== undefined && typeof bridge.url === 'string' ? { url: bridge.url, token: String(bridge.token ?? '') } : null,
    // Speech is served by the same bridge, so the note knows both where to ask and which voice to ask
    // for first. Without a bridge the page falls back to the browser's own voices.
    tts:
      bridge !== undefined && typeof bridge.url === 'string' && tts !== undefined
        ? { url: bridge.url, token: String(bridge.token ?? ''), voice: String(tts.voice ?? ''), voices: tts.voices ?? [] }
        : null,
    crops: crops.map((c) => ({
      doc: c.doc,
      page: c.page,
      label: c.label ?? undefined,
      quote: c.quote,
      png: c.png,
      w: c.w,
      h: c.h,
    })),
  };

  const template = await readFile(TEMPLATE, 'utf8');
  const pngBytes = images.reduce((n, c) => n + Math.round((c.png.length * 3) / 4), 0);
  const html = template
    .replace('<!--UNFOLD:DATA-->', jsonForHtml(payload))
    .replace('<!--UNFOLD:TITLE-->', escapeHtml(payload.title))
    .replace('<!--UNFOLD:BUILT-->', payload.builtAt.slice(0, 16).replace('T', ' '));

  const out = join(dir, 'notes.html');
  await writeFile(out, html, 'utf8');
  await writeJson(join(dir, 'notes.json'), notes);
  state.builtAt = payload.builtAt;
  state.updatedAt = payload.builtAt;
  state.title = payload.title;
  await writeJson(join(dir, 'project.json'), state);

  const report = {
    path: out,
    bytes: Buffer.byteLength(html),
    sections: normalized.sections.length,
    blocks: normalized.sections.reduce((n, s) => n + s.blocks.length, 0),
    beats: normalized.lecture.length,
    citations: cites,
    resolved,
    noQuote,
    notFound,
    images: images.length,
    imageBytes: pngBytes,
    rendererNote,
  };
  return report;
}

/** Escape text that lands in the HTML head. */
function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
}
