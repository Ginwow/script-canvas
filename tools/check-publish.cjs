const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const files=JSON.parse(fs.readFileSync(path.join(__dirname,'publish-files.json'),'utf8'));
assert.equal(new Set(files).size,files.length,'Duplicate publish entries');
const privatePath=/^(?:剧本|参考素材库|recovery|dist|node_modules|release)(?:\/|$)|(?:^|\/)\.env(?:\.|$)|(?:^|\/)(?:AGENTS|PROGRESS|HANDOFF)\.md$/i;
const personal=[/\b[A-Z]:[\\/]Users[\\/][^\s'"`]+/i,new RegExp('个人'+'画布')];
const credentials=[new RegExp('gh'+'[opusr]_[A-Za-z0-9]{30,}'),new RegExp('github'+'_pat_[A-Za-z0-9_]{30,}'),new RegExp('sk'+'-(?:proj-)?[A-Za-z0-9_-]{24,}'),/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/];
let bytes=0;
for(const file of files){
  assert(!path.isAbsolute(file)&&!file.split('/').includes('..')&&!privatePath.test(file),'Private or invalid publish path: '+file);
  const absolute=path.join(root,file),stat=fs.lstatSync(absolute);
  assert(stat.isFile()&&!stat.isSymbolicLink(),'Publish entries must be regular files: '+file);
  assert(stat.size<10*1024*1024,'Oversized source file: '+file);bytes+=stat.size;
  if(!/\.(png|ico)$/.test(file)){
    const text=fs.readFileSync(absolute,'utf8');
    for(const pattern of [...personal,...credentials])assert(!pattern.test(text),'Potential private path or secret in '+file);
  }
}
const p=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
for(const file of [...p.build.files,...p.build.extraResources])assert(files.includes(file),'Unreviewed build input: '+file);
assert.deepEqual(fs.readFileSync(path.join(root,'canvas-project.schema.json')),fs.readFileSync(path.join(root,'canvas-project-json-skill/references/canvas-project.schema.json')),'Schemas must match');
if(fs.existsSync(path.join(root,'.git'))){
  const result=spawnSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  for(const file of result.stdout.split('\0').filter(Boolean))assert(files.includes(file),'Unreviewed tracked file: '+file);
}
console.log(`Publish checks passed: ${files.length} audited files, ${(bytes/1024/1024).toFixed(2)} MiB; no personal projects, media libraries, local paths or detected credentials.`);
