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
    const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs/promises');
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
    for(const mapping of saved.videoAssets)Object.assign(state.nodes.find(node=>node.id===mapping.id),mapping);
    const priorPath=state.nodes[2].assetPath;
    // History snapshots retain their submitted alias, even when current nodes
    // have already received canonical project paths from an earlier save.
    const sibling=path.join(path.dirname(base),'sibling','sibling.json');
    await fs.mkdir(path.dirname(sibling),{recursive:true});await fs.writeFile(sibling,'{}');
    state.nodes[1].title='镜头02';
    const renamed=await store.save(file,state,[
      {projectPath:file,assetPath:priorPath},
      {projectPath:sibling,assetPath:priorPath},
      {projectPath:path.join(base,'missing.json'),assetPath:priorPath}
    ]);
    assert.equal(renamed.historyAssets.length,1);
    assert.equal(renamed.historyAssets[0].projectPath,file);
    assert.equal(renamed.historyAssets[0].assetPath,priorPath);
    assert.equal(await fs.readFile(path.join(base,renamed.historyAssets[0].pinnedPath),'utf8'),'video fixture');
    assert.equal(await fs.readFile(path.join(base,renamed.videoAssets[0].assetPath),'utf8'),'video fixture');
    for(const mapping of renamed.videoAssets)Object.assign(state.nodes.find(node=>node.id===mapping.id),mapping);
    await fs.writeFile(path.join(base,'assets/videos/second.mp4'),'second video fixture');
    state.nodes.push({id:'board2',kind:'storyboard',title:'镜头01'},{id:'video2',kind:'asset',assetPath:'assets/videos/second.mp4',projectPath:file});
    state.connections.push({fromId:'scene',toId:'board2'},{fromId:'board2',toId:'video2'});
    const paired=await store.save(file,state);
    for(const mapping of paired.videoAssets)Object.assign(state.nodes.find(node=>node.id===mapping.id),mapping);
    const history=state.nodes.filter(node=>node.assetPath).map(node=>({projectPath:file,assetPath:node.assetPath}));
    state.nodes[1].title='镜头01';state.nodes.find(node=>node.id==='board2').title='镜头02';
    const swapped=await store.save(file,state,history);
    assert.equal(swapped.historyAssets.length,2);
    for(const [index,mapping]of swapped.historyAssets.entries()){
      assert.equal(mapping.projectPath,file);
      assert.equal(await fs.readFile(path.join(base,mapping.pinnedPath),'utf8'),index===0?'video fixture':'second video fixture');
    }
    assert.equal(await fs.readFile(path.join(base,history[0].assetPath),'utf8'),'second video fixture');
    assert.equal(await fs.readFile(path.join(base,history[1].assetPath),'utf8'),'video fixture');
    const escaping=structuredClone(state);escaping.nodes[2].assetPath='assets/escape/escape.mp4';
    await assert.rejects(()=>nameStoryboardAssets(base,escaping,new Map()),/超出源项目/);
    await assert.rejects(()=>store.save(file,escaping),/超出源项目/);
  })().catch(error=>{console.error(error);process.exitCode=1;});`;
  await execFile(process.execPath,['-e',program,file],{cwd:path.join(__dirname,'..'),env:{...process.env,CANVAS_DATA_DIR:alias}});
  assert.ok(JSON.parse(await fs.readFile(file,'utf8')).canvas);
});
