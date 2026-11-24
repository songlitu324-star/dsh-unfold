import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';

const here = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const vendor = join(here, '..', 'vendor', 'package');

async function probe(build) {
  const base = build === 'legacy' ? join(vendor, 'legacy', 'build') : join(vendor, 'build');
  const mod = await import(pathToFileURL(join(base, 'pdf.min.mjs')).href);
  const pdfjs = mod.default ?? mod;
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(join(base, 'pdf.worker.min.mjs')).href;
  const data = new Uint8Array(await readFile(join(vendor, '..', 'test.pdf')));
  const doc = await pdfjs.getDocument({
    data,
    cMapUrl: pathToFileURL(join(vendor, 'cmaps') + '/').href,
    cMapPacked: true,
    standardFontDataUrl: pathToFileURL(join(vendor, 'standard_fonts') + '/').href,
    useSystemFonts: false,
  }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const lines = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const [a, b, c, d, e, f] = it.transform;
    lines.push({ t: it.str, x: +e.toFixed(1), y: +(vp.height - f).toFixed(1), w: +it.width.toFixed(1), h: +(it.height || Math.abs(d)).toFixed(1) });
  }
  console.log(build, 'pages', doc.numPages, 'size', vp.width, vp.height, 'items', tc.items.length);
  console.log(JSON.stringify(lines.slice(0, 5)));
  await doc.destroy();
}

for (const b of ['modern', 'legacy']) {
  try { await probe(b); } catch (e) { console.log(b, 'FAILED', e && e.message); }
}
