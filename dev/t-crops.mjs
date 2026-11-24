import { readFile } from 'node:fs/promises';
import { renderCrops, probeRenderer } from '../lib/crops.js';
import { boxOfQuote } from '../lib/build.js';
import { allPages } from '../lib/ingest.js';

const dir = 'C:/Users/tuson/Desktop/zy/.unfold/attention';
console.log('probe', JSON.stringify(await probeRenderer()));
const stored = await allPages(dir);
const page = stored.p1.pages.find((p) => p.n === 2);
const quote =
  'Attention mechanisms have become an integral part of compelling sequence modeling and transduction models in various tasks';
const box = boxOfQuote(page.lines, quote);
console.log('box', JSON.stringify(box));
const rect = { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 8), w: box.w + 16, h: box.h + 16 };
const out = await renderCrops({
  dir,
  requests: [{ id: 'c1', pdf: `${dir}/pdf/p1.pdf`, page: 2, rect }],
});
console.log('ok', out.ok, 'reason', out.reason, 'errors', JSON.stringify(out.errors), 'keys', Object.keys(out.crops));
for (const [k, v] of Object.entries(out.crops)) {
  console.log(k, v.w, 'x', v.h, 'b64', v.png.length);
  await (await import('node:fs/promises')).writeFile(`C:/Users/tuson/Desktop/zy/dsh-unfold/.tmp/${k}.png`, Buffer.from(v.png, 'base64'));
}
