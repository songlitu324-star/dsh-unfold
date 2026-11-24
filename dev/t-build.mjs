import { build } from '../lib/build.js';

const cwd = 'C:/Users/tuson/Desktop/zy';
const notes = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('./demo-attention.json', import.meta.url), 'utf8'));

const report = await build({ cwd, project: 'attention', notes });
console.log(JSON.stringify(report, null, 2));
