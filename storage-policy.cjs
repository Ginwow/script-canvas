const fs = require('node:fs/promises');
const path = require('node:path');
const DAY = 86400000;
const GENERATED_NAME = /^\d{13}-[0-9a-f-]{36}\.png$/i;
function within(base, target) { const relative = path.relative(base, target); return relative && !relative.startsWith('..') && !path.isAbsolute(relative); }
async function clearScratch(root, file, ageMs = 0) {
  const directory = path.join(root,'assets','generated','.canvas-tmp-' + path.basename(file,'.png'));
  try {
    const info = await fs.lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || Date.now()-info.mtimeMs < ageMs) return;
    const realRoot = await fs.realpath(root), realDirectory = await fs.realpath(directory);
    if (!within(realRoot,realDirectory) || path.dirname(realDirectory) !== path.join(realRoot,'assets','generated') || !path.basename(realDirectory).startsWith('.canvas-tmp-')) return;
    await fs.rm(realDirectory,{recursive:true,force:true});
  } catch(error) { if (error.code !== 'ENOENT') throw error; }
}
function createStoragePolicy(userData) {
  const inventoryPath = path.join(userData, 'canvas-generated-files.json');
  let queue = Promise.resolve();
  const serial = task => { const result = queue.then(task); queue = result.catch(() => {}); return result; };
  async function readInventory() { try { const parsed = JSON.parse(await fs.readFile(inventoryPath,'utf8')); if (!Array.isArray(parsed)) throw Error(); return parsed; } catch (error) { if (error.code === 'ENOENT') return []; throw new Error('生成文件登记损坏，已停止清理。'); } }
  async function writeInventory(items) { const temporary = inventoryPath + '.tmp'; await fs.writeFile(temporary, JSON.stringify(items), 'utf8'); await fs.rename(temporary, inventoryPath); }
  async function projectReferences(base) {
    const names = new Set(); let inspected = 0;
    async function visit(directory, depth) {
      if (depth > 6) throw new Error('项目目录过深，跳过自动清理。');
      for (const item of await fs.readdir(directory,{withFileTypes:true})) {
        if (++inspected > 4000) throw new Error('项目文件过多，跳过自动清理。');
        if (item.isSymbolicLink()) throw new Error('项目含链接目录，跳过自动清理。');
        const candidate = path.join(directory,item.name);
        if (item.isDirectory()) {
          if (['.git','node_modules'].includes(item.name)) continue;
          if (path.resolve(candidate) === path.resolve(base,'assets','generated')) continue;
          await visit(candidate,depth+1);
        } else if (item.isFile() && /\.json$/i.test(item.name)) {
          const stat = await fs.stat(candidate); if (stat.size > 5*1024*1024) throw new Error('项目 JSON 过大，跳过自动清理。');
          const text = await fs.readFile(candidate,'utf8'); JSON.parse(text.replace(/^\uFEFF/,''));
          for (const match of text.matchAll(/\d{13}-[0-9a-f-]{36}\.png/gi)) names.add(match[0].toLowerCase());
        }
      }
    }
    await visit(base,0); return names;
  }
  return {
    clearScratch: (projectPath, assetPath) => serial(async () => { const root=path.dirname(await fs.realpath(projectPath)); await clearScratch(root,path.basename(assetPath)); }),
    record: (projectPath, assetPath) => serial(async () => {
      const name = path.basename(assetPath); if (!GENERATED_NAME.test(name) || assetPath.replace(/\\/g,'/') !== 'assets/generated/' + name) return;
      const items = await readInventory(); const root = path.dirname(await fs.realpath(projectPath));
      const file = path.join(root,'assets','generated',name);
      if (!items.some(item => item.file === file)) { items.push({ file, root, created:Date.now() }); await writeInventory(items); }
    }),
    clean: payload => serial(async () => {
      if (!payload || !Array.isArray(payload.retainedNames) || payload.retainedNames.length > 10000) throw new Error('缺少画布引用清单，未清理任何文件。');
      const retained = new Set(payload.retainedNames.filter(name => typeof name === 'string').map(name => name.toLowerCase()));
      const items = await readInventory(); const keep = []; let deleted = 0, freed = 0, total = 0, skipped = 0;
      const refs = new Map();
      for (const item of items) {
        if (!item || typeof item.root !== 'string' || typeof item.file !== 'string' || !GENERATED_NAME.test(path.basename(item.file)) || path.dirname(item.file) !== path.join(item.root,'assets','generated')) { keep.push(item); continue; }
        try {
          await clearScratch(item.root,item.file,DAY);
          const info = await fs.lstat(item.file);
          if (!info.isFile() || info.isSymbolicLink()) { keep.push(item); continue; }
          const realRoot = await fs.realpath(item.root), realFile = await fs.realpath(item.file);
          if (!within(realRoot,realFile) || path.dirname(realFile) !== path.join(realRoot,'assets','generated')) { keep.push(item); continue; }
          total += info.size;
          if (Date.now()-Math.max(info.mtimeMs,item.created || info.mtimeMs) < 30*DAY || retained.has(path.basename(item.file).toLowerCase())) { keep.push(item); continue; }
          if (!refs.has(item.root)) refs.set(item.root, await projectReferences(item.root));
          if (refs.get(item.root).has(path.basename(item.file).toLowerCase())) { keep.push(item); continue; }
          await fs.unlink(realFile); freed += info.size; deleted++;
        } catch (error) { if (error.code !== 'ENOENT') { keep.push(item); skipped++; } }
      }
      await writeInventory(keep);
      return { ok:true, deleted, freed, bytes:total-freed, overBudget:total-freed > 512*1024*1024, skipped };
    })
  };
}
module.exports = { createStoragePolicy };
