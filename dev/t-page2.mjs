import { allPages } from '../lib/ingest.js';

const stored = await allPages('C:/Users/tuson/Desktop/zy/.unfold/attention');
const doc = stored.p1;
const page = doc.pages.find((p) => p.n === 2);
for (const l of page.lines) console.log(l.t);
