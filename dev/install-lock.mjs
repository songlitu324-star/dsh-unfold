/**
 * Keep the profile's lockfile in step with the `link:` dependency, the way `pnpm install` would have
 * written it (pnpm 9, `nodeLinker: hoisted`, `excludeLinksFromLockfile: false`). Only the importer
 * entry is needed: a `link:` specifier has no registry package behind it.
 */
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';

const LOCK = 'C:\\Users\\tuson\\.dsh\\profiles\\desktop\\pnpm-lock.yaml';
const SPEC = 'link:C:/Users/tuson/Desktop/zy/dsh-unfold';
const BLOCK = `      dsh-unfold:\n        specifier: ${SPEC}\n        version: ${SPEC}\n`;

const text = readFileSync(LOCK, 'utf8');
if (text.includes('dsh-unfold:')) {
  console.log('lockfile already has dsh-unfold');
} else {
  const anchor = '      dshmarket:\n';
  const at = text.indexOf(anchor);
  if (at < 0) throw new Error('anchor not found');
  copyFileSync(LOCK, `${LOCK}.bak-unfold`);
  writeFileSync(LOCK, text.slice(0, at) + BLOCK + text.slice(at), 'utf8');
  console.log('lockfile updated');
}
const check = readFileSync(LOCK, 'utf8');
const i = check.indexOf('      dsh-unfold:');
console.log(check.slice(i, i + 160));
