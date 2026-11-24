/** Which demo citations resolve? Prints the box or MISS per cite. */
import { readFileSync } from 'node:fs';
import { allPages } from '../lib/ingest.js';
import { boxOfQuote } from '../lib/build.js';

const stored = await allPages('C:\\Users\\tuson\\Desktop\\zy\\.unfold\\attention');
const demo = JSON.parse(readFileSync(new URL('./demo-attention.json', import.meta.url), 'utf8'));
for (const section of demo.sections) {
  for (const block of section.blocks) {
    for (const cite of block.cites ?? []) {
      const page = stored[cite.doc].pages.find((p) => p.n === cite.page);
      const box = boxOfQuote(page.lines, cite.quote);
      console.log(`${block.id} p${cite.page} ${box ? 'OK  ' : 'MISS'} ${JSON.stringify(cite.quote.slice(0, 80))}`);
    }
  }
}
