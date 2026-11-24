import { ingest, pagesOf } from '../lib/ingest.js';

const cwd = 'C:/Users/tuson/Desktop/zy';
const r = await ingest(cwd, { files: ['dsh-unfold/vendor/test.pdf'], name: 'attention', title: 'Attention Is All You Need' });
console.log('slug', r.slug, 'dir', r.dir);
console.log('added', JSON.stringify(r.added));
console.log('warnings', r.warnings);
const doc = await pagesOf(r.dir, r.added[0].id);
console.log('pages', doc.pages.length, 'size p2', doc.pages[1].w, doc.pages[1].h);
console.log('lines p2 (first 6):');
for (const l of doc.pages[1].lines.slice(0, 6)) console.log('  ', JSON.stringify(l));
console.log('chars p2', doc.pages[1].lines.reduce((n, l) => n + l.t.length, 0));
