/**
 * Install dsh-unfold into the desktop profile *without* running a package manager:
 * record the link: dependency + bundle name in package.json, and junction the package into
 * node_modules (which is exactly what pnpm would have produced for a link: dependency, minus a
 * full-resolution pass over the lockfile).
 */
import { existsSync, lstatSync, readFileSync, rmSync, symlinkSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const PROFILE = 'C:\\Users\\tuson\\.dsh\\profiles\\desktop';
const PKG = join(PROFILE, 'package.json');
const PLUGIN_DIR = 'C:\\Users\\tuson\\Desktop\\zy\\dsh-unfold';
const LINK = join(PROFILE, 'node_modules', 'dsh-unfold');

const raw = readFileSync(PKG, 'utf8');
copyFileSync(PKG, join(PROFILE, 'package.json.bak-unfold'));
const pkg = JSON.parse(raw);
pkg.dependencies = pkg.dependencies ?? {};
pkg.dependencies['dsh-unfold'] = `link:${PLUGIN_DIR.replaceAll('\\', '/')}`;
pkg.dsh = pkg.dsh ?? {};
pkg.dsh.profile = pkg.dsh.profile ?? {};
const bundles = pkg.dsh.profile.bundles ?? [];
if (!bundles.includes('dsh-unfold')) bundles.push('dsh-unfold');
pkg.dsh.profile.bundles = bundles;
writeFileSync(PKG, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
console.log('package.json written; bundles:', bundles.join(', '));

// Replace a stale entry, then link.
if (existsSync(LINK) || (lstatSync(LINK, { throwIfNoEntry: false })?.isSymbolicLink() ?? false)) {
  rmSync(LINK, { recursive: true, force: true });
  console.log('removed stale node_modules/dsh-unfold');
}
symlinkSync(PLUGIN_DIR, LINK, 'junction');
const linkedPkg = JSON.parse(readFileSync(join(LINK, 'package.json'), 'utf8'));
console.log('junction ok →', linkedPkg.name, linkedPkg.version);
console.log('files:', ['lib/index.js', 'lib/paths.js', 'assets/notes.template.html', 'skills/unfold/SKILL.md', 'cordis.patch.yml']
  .map((f) => `${f}=${existsSync(join(LINK, f))}`)
  .join(' '));
