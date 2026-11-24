/**
 * Page screenshots for citations: the note shows the actual PDF pixels under a hover, so a reader can
 * always check the claim against the page it came from.
 *
 * Rasterising is pdfium's job. It ships as an unpacked Python wheel (`vendor/pylib`) and is driven
 * through the interpreter that came with the DSH runtime: one process renders every crop of a note,
 * so a 20-citation note costs one Python start (~0.5 s) instead of twenty.
 *
 * Two constraints shape this file:
 *  - child processes may not own pipes here (a sandboxed host denies `stdio: 'pipe'`), so the child
 *    is started with `stdio: 'ignore'` and reports through files, not stdout;
 *  - everything degrades: no interpreter or no pdfium means the note is still built, just with the
 *    quote text instead of the picture.
 *
 * @module dsh-unfold/lib/crops
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
/** Unpacked pypdfium2 wheel. */
export const PY_LIB = join(HERE, '..', 'vendor', 'pylib');

/** Rendering dpi multiplier: 2.2x keeps body text crisp at a 640px card width. */
const SCALE = 2.2;

/**
 * Interpreter candidates, most specific first.
 * `DSH_UNFOLD_PYTHON` wins so a user can point at their own venv with pdfium installed.
 */
function interpreters() {
  const out = [];
  const env = process.env.DSH_UNFOLD_PYTHON;
  if (typeof env === 'string' && env.trim() !== '') out.push(env.trim());
  // The DSH runtime ships a Python next to its node: <deps>/node/bin/node.exe → <deps>/python/python.exe
  const runtime = process.env.DSH_RUNTIME_DIR;
  if (typeof runtime === 'string' && runtime !== '') out.push(join(runtime, 'dependencies', 'python', 'python.exe'));
  try {
    const deps = dirname(dirname(dirname(process.execPath)));
    out.push(join(deps, 'python', 'python.exe'), join(deps, 'python', 'bin', 'python3'));
  } catch {
    /* not a runtime layout */
  }
  out.push('python', 'python3', 'py');
  return [...new Set(out)];
}

/** Run a command with no pipes (the sandbox denies them) and return its exit status. */
function run(command, args, options) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { ...options, stdio: 'ignore', windowsHide: true });
    } catch (error) {
      resolve({ ok: false, reason: String(error?.message ?? error) });
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      resolve({ ok: false, reason: 'timeout' });
    }, 180_000);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, reason: String(error?.message ?? error) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, reason: code === 0 ? undefined : `exit code ${String(code)}` });
    });
  });
}

/** The renderer script: crop → PNG, and a JSON report next to the pictures. */
const SCRIPT = String.raw`
import json, os, sys
spec = json.load(open(sys.argv[1], "r", encoding="utf-8"))
sys.path.insert(0, spec["pylib"])
report = {"ok": True, "items": [], "errors": []}
try:
    import pypdfium2 as pdfium
except Exception as e:
    report = {"ok": False, "reason": "import pypdfium2 failed: %s" % (e,), "items": [], "errors": []}
    open(spec["report"], "w", encoding="utf-8").write(json.dumps(report))
    sys.exit(0)

docs = {}
for req in spec["requests"]:
    try:
        key = req["pdf"]
        if key not in docs:
            docs[key] = pdfium.PdfDocument(key)
        page = docs[key][req["page"] - 1]
        W, H = page.get_size()
        r = req["rect"]                      # top-origin, PDF points
        x, y, w, h = r["x"], r["y"], r["w"], r["h"]
        pad = req.get("pad", 0)
        x0 = max(0.0, x - pad); x1 = min(W, x + w + pad)
        y0 = max(0.0, y - pad); y1 = min(H, y + h + pad)
        crop = (x0, H - y1, W - x1, y0)      # (left, bottom, right, top) margins, in PDF points
        bmp = page.render(scale=spec["scale"], crop=crop)
        img = bmp.to_pil()
        path = os.path.join(spec["out"], req["id"] + ".png")
        img.save(path, optimize=True)
        report["items"].append({"id": req["id"], "file": path, "w": img.size[0], "h": img.size[1]})
    except Exception as e:
        report["errors"].append("%s: %s" % (req.get("id"), e))
open(spec["report"], "w", encoding="utf-8").write(json.dumps(report))
`;

/**
 * Render every crop of a note.
 *
 * @param {object} options
 * @param {string} options.dir - project folder (temp files are written here, never under the system temp)
 * @param {Array<{id:string, pdf:string, page:number, rect:{x:number,y:number,w:number,h:number}}>} options.requests
 * @returns {Promise<{ok:boolean, reason?:string, crops: Record<string, {png:string, w:number, h:number}>}>}
 */
export async function renderCrops({ dir, requests }) {
  if (requests.length === 0) return { ok: true, crops: {} };
  const outDir = join(dir, 'crops');
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const reportPath = join(dir, '.crops.report.json');
  await rm(reportPath, { force: true });
  const specPath = join(dir, '.crops.spec.json');
  const scriptPath = join(dir, '.crops.py');
  await writeFile(scriptPath, SCRIPT, 'utf8');
  await writeFile(
    specPath,
    JSON.stringify({ pylib: PY_LIB, out: outDir, report: reportPath, scale: SCALE, requests }),
    'utf8',
  );

  let lastReason = '找不到可用的 Python 解释器';
  for (const python of interpreters()) {
    if (!python.includes('/') && !python.includes('\\') && !existsSync(python) && python.length > 0) {
      // bare names ("python") are looked up on PATH by the OS; only pre-check absolute paths
    }
    const result = await run(python, [scriptPath, specPath], {
      cwd: dir,
      env: { ...process.env, PYTHONPATH: PY_LIB, PYTHONIOENCODING: 'utf-8' },
    });
    if (!result.ok) {
      lastReason = `${python}: ${result.reason}`;
      continue;
    }
    let report;
    try {
      report = JSON.parse(await readFile(reportPath, 'utf8'));
    } catch {
      lastReason = `${python}: 渲染进程没有写出报告`;
      continue;
    }
    if (report.ok !== true) {
      lastReason = String(report.reason ?? '渲染失败');
      continue;
    }
    const crops = {};
    for (const item of report.items ?? []) {
      try {
        const bytes = await readFile(item.file);
        crops[item.id] = { png: bytes.toString('base64'), w: item.w, h: item.h };
      } catch {
        /* a missing crop only costs the picture */
      }
    }
    const errors = Array.isArray(report.errors) ? report.errors : [];
    await rm(scriptPath, { force: true });
    await rm(specPath, { force: true });
    await rm(reportPath, { force: true });
    return { ok: true, crops, errors };
  }
  await rm(scriptPath, { force: true });
  await rm(specPath, { force: true });
  return { ok: false, reason: lastReason, crops: {} };
}

/**
 * Whether a usable interpreter + pdfium is present (used by the status tool to be honest up front).
 * @returns {Promise<{ok:boolean, python?:string, reason?:string}>}
 */
export async function probeRenderer() {
  if (!existsSync(PY_LIB)) return { ok: false, reason: 'vendor/pylib 缺失' };
  let lastReason;
  for (const python of interpreters()) {
    const mod = await run(python, ['-c', 'import pypdfium2'], { env: { ...process.env, PYTHONPATH: PY_LIB } });
    if (mod.ok) return { ok: true, python };
    lastReason = `${python}: ${mod.reason ?? 'import pypdfium2 失败'}`;
  }
  return { ok: false, reason: lastReason ?? '没有可用的 Python' };
}

/** List leftover crop images (debug helper). */
export async function cropFiles(dir) {
  try {
    return await readdir(join(dir, 'crops'));
  } catch {
    return [];
  }
}
