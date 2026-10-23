const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {promisify}=require('node:util');
const execFile=promisify(require('node:child_process').execFile);

test('managed open/save and asset naming accept aliases while rejecting escaped assets',async t=>{
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'canvas-alias-'));
  t.after(()=>fs.rm(temporary,{recursive:true,force:true}));
  const actual=path.join(temporary,'actual'),alias=path.join(temporary,'alias');
  const base=path.join(actual,'剧本','别名项目');
  await fs.mkdir(path.join(base,'assets','videos'),{recursive:true});
  try {await fs.symlink(actual,alias,process.platform==='win32'?'junction':'dir');}
  catch(error){if(['EPERM','EACCES','ENOTSUP'].includes(error.code)){t.skip('Filesystem does not permit directory aliases');return;}throw error;}
  const file=path.join(alias,'剧本','别名项目','别名项目.json');
  await fs.writeFile(file,JSON.stringify({project:{title:'别名项目'},shots:[],storyboards:[]}));
  await fs.writeFile(path.join(base,'assets','videos','source.mp4'),'video fixture');
  const outside=path.join(temporary,'outside');await fs.mkdir(outside);
  await fs.writeFile(path.join(outside,'escape.mp4'),'outside fixture');
  await fs.symlink(outside,path.join(base,'assets','escape'),process.platform==='win32'?'junction':'dir');
  const program=`(async()=>{
    const assert=require('node:assert/strict'),path=require('node:path');
    const store=require('./project-store.cjs'),{nameStoryboardAssets}=require('./asset-naming.cjs');
    const file=process.argv[1],base=path.dirname(file);
    const state={projectSource:{path:file},nodes:[
      {id:'scene',kind:'shot',title:'场景01'},
      {id:'board',kind:'storyboard',title:'镜头01'},
      {id:'video',kind:'asset',assetPath:'assets/videos/source.mp4',projectPath:file}
    ],connections:[{fromId:'scene',toId:'board'},{fromId:'board',toId:'video'}]};
    assert.equal((await store.open(file)).project.project.title,'别名项目');
    const namingState=structuredClone(state),writes=new Map();
    await nameStoryboardAssets(base,namingState,writes);
    assert.equal(writes.size,1);
    const saved=await store.save(file,state);assert.ok(saved.project);
    const escaping=structuredClone(state);escaping.nodes[2].assetPath='assets/escape/escape.mp4';
    await assert.rejects(()=>nameStoryboardAssets(base,escaping,new Map()),/超出源项目/);
    await assert.rejects(()=>store.save(file,escaping),/超出源项目/);
  })().catch(error=>{console.error(error);process.exitCode=1;});`;
  await execFile(process.execPath,['-e',program,file],{cwd:path.join(__dirname,'..'),env:{...process.env,CANVAS_DATA_DIR:alias}});
  assert.ok(JSON.parse(await fs.readFile(file,'utf8')).canvas);
});
