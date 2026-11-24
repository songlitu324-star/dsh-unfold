import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const deps = dirname(dirname(dirname(process.execPath)));
const py = join(deps, 'python', 'python.exe');
console.log('py exists', existsSync(py), py);

function run(command, args, stdio) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio, windowsHide: true, cwd: 'C:/Users/tuson/Desktop/zy/dsh-unfold/.tmp' });
    child.on('error', (e) => resolve({ ok: false, err: String(e?.message ?? e) }));
    child.on('close', (code) => resolve({ ok: code === 0, code }));
  });
}

console.log('pipe probe:', await run(py, ['-c', 'print(1)'], 'pipe'));
console.log('ignore probe:', await run(py, ['-c', 'print(1)'], 'ignore'));
