/**
 * PDF text layer, in-process: pdf.js (the `legacy` build, which is the one that runs in Node) turns a
 * page into lines with bounding boxes, so a citation can later be pointed at real pixels.
 *
 * The vendored pdf.js is only used here, never shipped to the browser: page screenshots for the note
 * are rasterised by pdfium (see ./crops.js), which keeps the note free of a 2 MB PDF engine.
 *
 * @module dsh-unfold/lib/pdf
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
/** Vendor root: `<plugin>/vendor/package`. */
const VENDOR = join(HERE, '..', 'vendor', 'package');
const BUILD_DIR = join(VENDOR, 'legacy', 'build');

/** @type {Promise<any> | undefined} */
let pdfjsPromise;

/** Load pdf.js once. */
function loadPdfjs() {
  if (pdfjsPromise === undefined) {
    pdfjsPromise = import(pathToFileURL(join(BUILD_DIR, 'pdf.min.mjs')).href).then((mod) => {
      const pdfjs = mod.default ?? mod;
      pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(join(BUILD_DIR, 'pdf.worker.min.mjs')).href;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

/** Round to one decimal: enough for a box, small enough for the JSON. */
const r1 = (n) => Math.round(n * 10) / 10;

/**
 * Merge pdf.js text runs into visual lines.
 *
 * Runs are per-style fragments; a line is every run sharing a baseline (within 3pt). Two things have
 * to be separated here:
 *
 * - geometry: every run in the line belongs to the box, subscripts included, because the citation
 *   screenshot should show the line as it looks on the page;
 * - text: subscripts and superscripts (`h` + `t`-small, `t`-small + `−1`) are not prose. Left in,
 *   "hidden states h_t, as a function" extracts as "hidden states h t , as a function" and every
 *   quote spanning an equation fails to match. They are marked by a clearly smaller font size, so
 *   they are dropped from the text while the box keeps them.
 *
 * The gaps between runs are turned back into spaces using the x-gap heuristic PDF extraction always
 * needs (words are separate runs, letters inside a word are not; CJK runs carry their own metrics).
 */
function groupLines(items, viewport) {
  const glyphs = [];
  for (const item of items) {
    const str = item.str;
    if (typeof str !== 'string' || str.trim().length === 0) continue;
    const t = item.transform;
    if (!Array.isArray(t) || t.length < 6) continue;
    const size = Math.hypot(t[2], t[3]) || Math.abs(item.height ?? t[3] ?? 10) || 10;
    const h = Math.abs(item.height ?? t[3] ?? 10) || 10;
    glyphs.push({
      str,
      x: t[4],
      // transform is baseline-origin, bottom-up; the note and pdfium both want top-down
      y: viewport.height - t[5] - h,
      w: item.width ?? 0,
      h,
      size,
    });
  }
  glyphs.sort((a, b) => (Math.abs(a.y - b.y) < 3 ? a.x - b.x : a.y - b.y));

  /** First pass: bucket runs by baseline. */
  const rows = [];
  let row = null;
  for (const g of glyphs) {
    if (row === null || Math.abs(g.y - row.y) > 3) {
      row = { y: g.y, runs: [g] };
      rows.push(row);
      continue;
    }
    row.runs.push(g);
  }

  /**
   * The page's body size: the font size that most characters are set in. Rows set entirely below it
   * are the stray equation fragments that pdf.js emits on their own baseline (a subscript `t` under
   * `state h_t` lands 4pt lower than its sentence and becomes a line of its own). They are not prose
   * and they sit inside the sentence's box anyway, so they are dropped rather than joined.
   */
  const bySize = new Map();
  for (const bucket of rows) {
    const size = Math.max(...bucket.runs.map((g) => g.size));
    const chars = bucket.runs.reduce((n, g) => n + g.str.length, 0);
    bySize.set(size, (bySize.get(size) ?? 0) + chars);
  }
  const bodySize = [...bySize.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10;

  const lines = [];
  for (const bucket of rows) {
    const runs = bucket.runs.sort((a, b) => a.x - b.x);
    const maxSize = Math.max(...runs.map((g) => g.size));
    const chars = runs.reduce((n, g) => n + g.str.length, 0);
    if (maxSize < bodySize * 0.85 && chars <= 14 && runs.length <= 6) continue;

    // Only body-size runs make up the text; a subscript that survived inside a line is left out so
    // quotes spanning it still match the prose. Its box still counts for the geometry below, and its
    // end position still counts for the gap measurement — otherwise "h_t," would become "h ,".
    let text = '';
    let endX;
    for (const g of runs) {
      const body = g.size >= maxSize * 0.85;
      if (body) {
        if (text.length === 0) {
          text = g.str;
        } else {
          const gap = g.x - endX;
          const needsSpace = gap > 1.2 && !/\s$/.test(text) && !/^\s/.test(g.str);
          text += (needsSpace ? ' ' : '') + g.str;
        }
      }
      endX = Math.max(endX ?? -Infinity, g.x + g.w);
    }
    if (text.trim().length === 0) continue;

    const x = Math.min(...runs.map((g) => g.x));
    const right = Math.max(...runs.map((g) => g.x + g.w));
    lines.push({
      // A subscript that became its own row leaves a hole in this one, and the gap heuristic reads the
      // hole as a space: "state h ," — punctuation never needs a space in front of it.
      t: text.replace(/\s+([,.;:!?])/g, '$1').replace(/\s+/g, ' ').trim(),
      x: r1(x),
      y: r1(Math.min(...runs.map((g) => g.y))),
      w: r1(right - x),
      h: r1(Math.max(...runs.map((g) => g.h))),
    });
  }

  return lines.filter((l) => l.t.length > 0);
}

/**
 * Read a PDF into per-page lines.
 * @param {Uint8Array} data - the file bytes
 * @returns {Promise<{numPages:number, pages:Array<{n:number,w:number,h:number,lines:any[]}>}>}
 */
export async function extractPages(data) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({
    data,
    cMapUrl: pathToFileURL(join(VENDOR, 'cmaps') + '/').href,
    cMapPacked: true,
    standardFontDataUrl: pathToFileURL(join(VENDOR, 'standard_fonts') + '/').href,
    isEvalSupported: false,
  }).promise;
  const pages = [];
  try {
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      let items = [];
      try {
        const content = await page.getTextContent();
        items = content.items;
      } catch {
        items = [];
      }
      pages.push({
        n,
        w: r1(viewport.width),
        h: r1(viewport.height),
        lines: groupLines(items, viewport),
      });
      page.cleanup();
    }
    return { numPages: doc.numPages, pages };
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}

/** Plain text of a page, lines joined with newlines. */
export function pageText(page) {
  return (page?.lines ?? []).map((l) => l.t).join('\n');
}
