/**
 * Fetch a small dependency tree from the npm registry into `vendor/dom/node_modules`, without npm.
 * Only used by the local DOM smoke test (`dev/t-dom.mjs`), not by the plugin at runtime.
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'C:\\Users\\tuson\\Desktop\\zy\\dsh-unfold\\vendor\\dom\\node_modules';
const registry = (name) => `https://registry.npmjs.org/${name.replace('/', '%2f')}`;

async function meta(name) {
  const res = await fetch(registry(name));
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.json();
}

/** latest first, then walk the dependency tree (flat install, like npm 3+). */
async function install(name, seen = new Set()) {
  if (seen.has(name)) return;
  seen.add(name);
  const info = await meta(name);
  const version = info['dist-tags'].latest;
  const pkg = info.versions[version];
  const dir = join(OUT, name);
  if (!existsSync(join(dir, 'package.json'))) {
    await mkdir(dir, { recursive: true });
    const tgz = Buffer.from(await (await fetch(pkg.dist.tarball)).arrayBuffer());
    const tarPath = join(OUT, `${name.replace('/', '_')}-${version}.tgz`);
    await writeFile(tarPath, tgz);
    const { execFileSync } = await import('node:child_process');
    execFileSync('tar', ['-xzf', tarPath, '--strip-components=1', '-C', dir], { stdio: 'ignore' });
    console.log(`installed ${name}@${version}`);
  } else {
    console.log(`kept ${name}@${version}`);
  }
  for (const dep of Object.keys(pkg.dependencies ?? {})) await install(dep, seen);
}

await install(process.argv[2] ?? 'linkedom');
const linked = JSON.parse(await readFile(join(OUT, 'linkedom', 'package.json'), 'utf8'));
console.log('linkedom', linked.version, 'entry', linked.exports ? Object.keys(linked.exports).join(',') : linked.main);
