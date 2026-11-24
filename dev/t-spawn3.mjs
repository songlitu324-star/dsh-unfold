import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'C:/Users/tuson/Desktop/zy/dsh-unfold/.tmp/croptest';
const out = join(dir, 'crops');
await mkdir(out, { recursive: true });
const report = join(dir, 'report.json');
const script = join(dir, 'r.py');
const spec = join(dir, 'spec.json');
const pylib = 'C:/Users/tuson/Desktop/zy/dsh-unfold/vendor/pylib';

await writeFile(
  script,
  `import json,sys
spec=json.load(open(sys.argv[1],encoding="utf-8"))
sys.path.insert(0,spec["pylib"])
open(spec["report"],"w",encoding="utf-8").write(json.dumps({"ok":True,"argv":sys.argv,"spec":spec}))
`,
  'utf8',
);
await writeFile(
  spec,
  JSON.stringify({ pylib, out, report, requests: [{ id: 'c1' }] }),
  'utf8',
);

const py = 'C:/Users/tuson/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/python.exe';
const code = await new Promise((resolve) => {
  const child = spawn(py, ['-c', 'print(1)'], { stdio: 'ignore', windowsHide: true });
  child.on('close', (c) => resolve(c));
  child.on('error', (e) => resolve(String(e?.message ?? e)));
});
console.log('trivial exit', code);

const code2 = await new Promise((resolve) => {
  const child = spawn(py, [script, spec], { stdio: 'ignore', windowsHide: true, cwd: dir });
  child.on('close', (c) => resolve(c));
  child.on('error', (e) => resolve(String(e?.message ?? e)));
});
console.log('script exit', code2, 'report exists', existsSync(report));
if (existsSync(report)) console.log((await readFile(report, 'utf8')).slice(0, 400));
