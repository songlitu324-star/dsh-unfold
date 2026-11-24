/** Print the stored lines of a page, to see what the extractor actually produced. */
import { allPages } from '../lib/ingest.js';

const pageArg = Number(process.argv[2] ?? 2);
const stored = await allPages('C:\\Users\\tuson\\Desktop\\zy\\.unfold\\attention');
const page = stored.p1.pages.find((p) => p.n === pageArg);
console.log(`p.${page.n} lines=${page.lines.length}`);
for (const line of page.lines) {
  console.log(`y=${String(line.y).padStart(6)} x=${String(line.x).padStart(5)} w=${String(line.w).padStart(5)} | ${line.t}`);
}
