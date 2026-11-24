import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

const py = join(dirname(dirname(dirname(process.execPath))), 'python', 'python.exe');
const cwd = 'C:/Users/tuson/Desktop/zy/dsh-unfold/.tmp';

function safeSpawn(command, args, options) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { ...options, windowsHide: true });
    } catch (error) {
      resolve({ ok: false, sync: String(error?.message ?? error) });
      return;
    }
    child.on('error', (error) => resolve({ ok: false, err: String(error?.message ?? error) }));
    child.on('close', (code) => resolve({ ok: code === 0, code }));
  });
}

for (const stdio of ['ignore', 'inherit', ['ignore', 'ignore', 'ignore']]) {
  console.log('spawn', JSON.stringify(stdio), await safeSpawn(py, ['-c', 'open("a.txt","w").write("hi")'], { stdio, cwd }));
}

try {
  const r = spawnSync(py, ['-c', 'open("b.txt","w").write("hi")'], { stdio: 'ignore', cwd });
  console.log('spawnSync', r.status, r.error ? String(r.error.message) : '');
} catch (error) {
  console.log('spawnSync threw', String(error?.message ?? error));
}
