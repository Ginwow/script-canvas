const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { resolveDataRoot, rebaseManagedPath } = require('../data-paths.cjs');

test('data directory override, existing ancestors, and clean-install fallback', () => {
  const base=path.resolve('isolated-data'), start=path.join(base,'dist','win-unpacked');
  const documents=path.resolve('isolated-documents');
  assert.equal(resolveDataRoot({override:base,start,documents,electron:true}),base);
  assert.throws(()=>resolveDataRoot({override:'relative'}),/绝对路径/);
  assert.equal(resolveDataRoot({start,documents,electron:true,exists:file=>file===path.join(base,'剧本')}),base);
  assert.equal(resolveDataRoot({start,documents,electron:true,exists:()=>false}),path.join(documents,'剧本画布'));
  assert.equal(resolveDataRoot({start,exists:()=>false}),start);
  assert.equal(resolveDataRoot({start,documents,electron:true,exists:file=>file===path.join(base,'项目')}),base);
});

test('stale marker rebases a renamed root while keeping the Chinese title', async t => {
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'canvas-paths-'));
  t.after(()=>fs.rm(temporary,{recursive:true,force:true}));
  const root=path.join(temporary,'new-root','剧本'),title='测试短片 · 01';
  const current=path.join(root,title,title+'.json');
  await fs.mkdir(path.dirname(current),{recursive:true});await fs.writeFile(current,'{}');
  const old=path.join(temporary,'old-root','剧本',title,title+'.json');
  assert.equal(await rebaseManagedPath(old,root),await fs.realpath(current));
  assert.equal(await rebaseManagedPath(path.join(temporary,'old-root','项目',title,title+'.json'),root),await fs.realpath(current));
  const unrelated=path.join(temporary,'outside',title,title+'.json');
  assert.equal(await rebaseManagedPath(unrelated,root),unrelated);
  const missing=path.join(temporary,'old-root','剧本','missing','missing.json');
  assert.equal(await rebaseManagedPath(missing,root),missing);
  await fs.mkdir(path.dirname(old),{recursive:true});await fs.writeFile(old,'{}');
  assert.equal(await rebaseManagedPath(old,root),old);
});

test('openLast repairs the last-project marker after moving the data directory', async t => {
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'canvas-marker-'));
  t.after(()=>fs.rm(temporary,{recursive:true,force:true}));
  const root=path.join(temporary,'剧本'),title='迁移后的短片',current=path.join(root,title,title+'.json');
  const old=path.join(temporary,'old-location','剧本',title,title+'.json');
  await fs.mkdir(path.dirname(current),{recursive:true});
  await fs.writeFile(current,JSON.stringify({format:'white-canvas-video-project',version:3,project:{title},shots:[],storyboards:[]}));
  await fs.writeFile(path.join(root,'.last-project.json'),JSON.stringify({path:old}));
  const { promisify }=require('node:util');
  const execFile=promisify(require('node:child_process').execFile);
  const program="require('./project-store.cjs').openLast().then(result=>console.log(JSON.stringify(result.projectPath))).catch(error=>{console.error(error);process.exitCode=1;})";
  const {stdout}=await execFile(process.execPath,['-e',program],{cwd:path.join(__dirname,'..'),env:{...process.env,CANVAS_DATA_DIR:temporary}});
  assert.equal(JSON.parse(stdout.trim()),await fs.realpath(current));
  const marker=JSON.parse(await fs.readFile(path.join(root,'.last-project.json'),'utf8'));
  assert.equal(marker.path,await fs.realpath(current));
});
