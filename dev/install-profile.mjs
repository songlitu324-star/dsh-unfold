/**
 * Install dsh-unfold into the desktop profile: add the link: dependency, list it as a bundle, install.
 * Run once; safe to re-run (idempotent).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PROFILE = 'C:\\Users\\tuson\\.dsh\\profiles\\desktop';
const PKG = join(PROFILE, 'package.json');
const PLUGIN = 'C:/Users/tuson/Desktop/zy/dsh-unfold';
const NODE = 'C:\\Users\\tuson\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\node\\bin\\node.exe';
const PNPM = 'C:\\Users\\tuson\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\pnpm\\bin\\pnpm.mjs';

const pkg = JSON.parse(readFileSync(PKG, 'utf8'));
pkg.dependencies = pkg.dependencies ?? {};
pkg.dependencies['dsh-unfold'] = `link:${PLUGIN}`;
pkg.dsh = pkg.dsh ?? {};
pkg.dsh.profile = pkg.dsh.profile ?? {};
const bundles = pkg.dsh.profile.bundles ?? [];
if (!bundles.includes('dsh-unfold')) bundles.push('dsh-unfold');
pkg.dsh.profile.bundles = bundles;
writeFileSync(PKG, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
console.log('package.json updated; bundles:', bundles.length);

const install = execFileSync(
  NODE,
  [PNPM, 'install', '--prefer-offline', '--no-frozen-lockfile', '--reporter=append-only'],
  { cwd: PROFILE, encoding: 'utf8', stdio: 'pipe', timeout: 240000, env: { ...process.env, CI: '1' } },
);
console.log(install.slice(-2000));

const linked = join(PROFILE, 'node_modules', 'dsh-unfold');
console.log('linked:', existsSync(linked));
if (existsSync(linked)) {
  const linkedPkg = JSON.parse(readFileSync(join(linked, 'package.json'), 'utf8'));
  console.log('linked package:', linkedPkg.name, linkedPkg.version);
}
