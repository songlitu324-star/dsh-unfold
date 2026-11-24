import { allPages } from '../lib/ingest.js';

const dir = 'C:/Users/tuson/Desktop/zy/.unfold/attention';
const stored = await allPages(dir);
const queries = [
  'inherently sequential nature precludes parallelization',
  'Attention mechanisms have become an integral part',
  'allowing modeling of dependencies without regard to their distance',
  'The Transformer allows for significantly more parallelization',
];
for (const q of queries) {
  console.log('==', q);
  let n = 0;
  for (const [id, doc] of Object.entries(stored)) {
    for (const page of doc.pages) {
      for (const line of page.lines) {
        if (line.t.toLowerCase().includes(q.toLowerCase())) {
          console.log(`  ${id} p.${page.n}: ${line.t.slice(0, 160)}`);
          n += 1;
        }
      }
      if (n > 3) break;
    }
    if (n > 3) break;
  }
}
