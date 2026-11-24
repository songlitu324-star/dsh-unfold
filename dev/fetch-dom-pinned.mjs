/**
 * Fetch a pinned package list into `vendor/dom/node_modules` (flat), without npm.
 * Pinned on purpose: the "latest of every dependency" approach mixes majors that do not fit together
 * (htmlparser2@12 + entities@9 was the first casualty).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const OUT = 'C:\\Users\\tuson\\Desktop\\zy\\dsh-unfold\\vendor\\dom\\node_modules';

const PINNED = [
  ['linkedom', '0.18.15'],
  ['uhyphen', '0.2.0'],
  ['cssomnom', '0.1.12'],
  ['css-select', '7.0.0'],
  ['css-what', '6.1.0'],
  ['boolbase', '1.0.0'],
  ['nth-check', '2.1.1'],
  ['domhandler', '5.0.3'],
  ['domutils', '3.2.2'],
  ['domelementtype', '2.3.0'],
  ['dom-serializer', '2.0.0'],
  ['entities', '7.0.1'],
  ['htmlparser2', '10.1.0'],
  ['html-escaper', '3.0.3'],
];

for (const [name, version] of PINNED) {
  const dir = join(OUT, name);
  if (existsSync(join(dir, 'package.json'))) {
    console.log(`kept ${name}@${version}`);
    continue;
  }
  const res = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2f')}`);
  const info = await res.json();
  const pkg = info.versions[version];
  if (pkg === undefined) throw new Error(`${name}@${version} not found`);
  await mkdir(dir, { recursive: true });
  const tgz = Buffer.from(await (await fetch(pkg.dist.tarball)).arrayBuffer());
  const tarPath = join(OUT, `${name.replace('/', '_')}-${version}.tgz`);
  await writeFile(tarPath, tgz);
  execFileSync('tar', ['-xzf', tarPath, '--strip-components=1', '-C', dir], { stdio: 'ignore' });
  console.log(`installed ${name}@${version}`);
}
