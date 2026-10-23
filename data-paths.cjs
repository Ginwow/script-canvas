const fs = require('node:fs');
const path = require('node:path');

function resolveDataRoot({ override, start = __dirname, documents, electron = false, exists = fs.existsSync } = {}) {
  if (override) {
    if (!path.isAbsolute(override)) throw new Error('CANVAS_DATA_DIR 必须是绝对路径');
    return path.resolve(override);
  }
  let candidate = path.resolve(start);
  for (let depth = 0; depth <= 3; depth++) {
    if (['剧本', '参考素材库', '项目'].some(name => exists(path.join(candidate, name)))) return candidate;
    const parent = path.dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  return electron ? path.join(documents, '剧本画布') : path.resolve(start);
}

let electronApp;
if (process.versions.electron) electronApp = require('electron').app;
const DATA_ROOT = resolveDataRoot({
  override: process.env.CANVAS_DATA_DIR,
  start: electronApp?.isPackaged ? path.dirname(process.execPath) : __dirname,
  documents: electronApp?.getPath('documents'),
  electron: Boolean(electronApp)
});
const PROJECT_ROOT = path.join(DATA_ROOT, '剧本');
const LEGACY_PROJECT_ROOT = path.join(DATA_ROOT, '项目');
const REFERENCE_ROOT = path.join(DATA_ROOT, '参考素材库');

// Rebase only the known managed layout, never an arbitrary path or traversal.
async function rebaseManagedPath(source, root = PROJECT_ROOT) {
  if (typeof source !== 'string' || !path.isAbsolute(source)) return source;
  try { await fs.promises.access(source); return source; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const parent = path.dirname(source), title = path.basename(parent), name = path.basename(source);
  if (!['剧本', '项目'].includes(path.basename(path.dirname(parent))) || !title || title === '..' ||
      ![title + '.json', '项目.json'].includes(name)) return source;
  const candidate = path.join(root, title, name);
  try {
    const realRoot = await fs.promises.realpath(root), real = await fs.promises.realpath(candidate);
    const relative = path.relative(realRoot, real);
    if (!relative || relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative) ||
        path.dirname(path.dirname(real)) !== realRoot || !(await fs.promises.stat(real)).isFile()) return source;
    return real;
  } catch (error) { if (error.code !== 'ENOENT') throw error; return source; }
}

module.exports = { DATA_ROOT, PROJECT_ROOT, LEGACY_PROJECT_ROOT, REFERENCE_ROOT, resolveDataRoot, rebaseManagedPath };
