/**
 * One-shot fix: PowerShell's Set-Content -Encoding utf8 writes a BOM under Windows PowerShell 5.1,
 * and npm refuses to read a package.json that starts with one. Strip it and re-validate.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../package.json', import.meta.url);
const raw = readFileSync(path, 'utf8');
const clean = raw.replace(/^\uFEFF/, '');
writeFileSync(path, clean, 'utf8');
const pkg = JSON.parse(clean);
console.log('ok:', pkg.name, pkg.version, '| author:', pkg.author, '| repo:', pkg.repository.url);
console.log('bom removed:', raw.length !== clean.length);
