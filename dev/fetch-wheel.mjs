import { writeFile } from 'node:fs/promises';

const meta = await (await fetch('https://pypi.org/pypi/pypdfium2/json')).json();
const ver = meta.info.version;
const files = meta.releases[ver] || (await (await fetch(`https://pypi.org/pypi/pypdfium2/${ver}/json`)).json()).urls;
const pick = files.find((f) => f.filename.includes('win_amd64'));
console.log('version', ver, 'file', pick?.filename, pick?.size);
const buf = Buffer.from(await (await fetch(pick.url)).arrayBuffer());
await writeFile('C:/Users/tuson/Desktop/zy/dsh-unfold/vendor/pypdfium2.whl', buf);
console.log('saved', buf.length);
