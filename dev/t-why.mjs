/** Show the squashed text of page 2 around a phrase, plus the quote's squashed form. */
import { readFileSync } from 'node:fs';
import { allPages } from '../lib/ingest.js';
import { squash } from '../lib/build.js';

const stored = await allPages('C:\\Users\\tuson\\Desktop\\zy\\.unfold\\attention');
const demo = JSON.parse(readFileSync(new URL('./demo-attention.json', import.meta.url), 'utf8'));
const cite = demo.sections[0].blocks.find((b) => b.id === 'b1').cites[0];
const page = stored[cite.doc].pages.find((p) => p.n === cite.page);
const joined = page.lines.map((l) => squash(l.t)).join('');
const target = squash(cite.quote);
console.log('target:', JSON.stringify(target.slice(0, 120)));
const probe = target.slice(0, 40);
const at = joined.indexOf(probe);
console.log('probe at:', at);
if (at >= 0) {
  console.log('page   :', JSON.stringify(joined.slice(at, at + target.length + 40)));
  console.log('quote  :', JSON.stringify(target));
}
const at2 = joined.indexOf('thisinherently');
console.log('"thisinherently" at:', at2);
if (at2 >= 0) console.log('context:', JSON.stringify(joined.slice(at2 - 60, at2 + 200)));
