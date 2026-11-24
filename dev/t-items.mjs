/** Dump the raw text items for the page-2 paragraph, with font sizes, to see how subscripts differ. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const VENDOR = join(HERE, '..', 'vendor', 'package', 'legacy', 'build', 'pdf.min.mjs');
const WORKER = join(HERE, '..', 'vendor', 'package', 'legacy', 'build', 'pdf.worker.min.mjs');
const CMAP = join(HERE, '..', 'vendor', 'package', 'cmaps') + '/';
const FONTS = join(HERE, '..', 'vendor', 'package', 'standard_fonts') + '/';

const pdfjs = await import(pathToFileURL(VENDOR).href);
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(WORKER).href;
const doc = await pdfjs.getDocument({
  data: new Uint8Array(readFileSync('C:\\Users\\tuson\\Desktop\\zy\\.unfold\\attention\\pdf\\p1.pdf')),
  cMapUrl: CMAP,
  cMapPacked: true,
  standardFontDataUrl: FONTS,
}).promise;
const page = await doc.getPage(2);
const content = await page.getTextContent();
for (const item of content.items) {
  if (/\b(t|h|h−1|t−1|n)\b/.test(item.str) && item.str.length < 12) {
    console.log(
      JSON.stringify(item.str),
      'size=', Math.hypot(item.transform[2], item.transform[3]).toFixed(2),
      'height=', item.height?.toFixed?.(2),
      'y=', item.transform[5].toFixed(1),
      'x=', item.transform[4].toFixed(1),
      'w=', item.width.toFixed(1),
    );
  }
}
await doc.destroy();
