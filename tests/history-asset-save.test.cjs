const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {createHash}=require('node:crypto');

(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'canvas-history-save-'));
 try {
  const base=path.join(root,'test'),file=path.join(base,'test.json');
  await fs.mkdir(path.join(base,'assets/videos'),{recursive:true});
  await fs.writeFile(file,JSON.stringify({project:{title:'test'},shots:[],storyboards:[]}));
  const bytesA=Buffer.from('distinct video A'),bytesB=Buffer.from('distinct video B');
  await fs.writeFile(path.join(base,'assets/videos/a.mp4'),bytesA);
  await fs.writeFile(path.join(base,'assets/videos/b.mp4'),bytesB);
  const module={exports:{}},localRequire=createRequire(path.resolve('project-store.cjs'));
  let fail=false,extra=null;
  const source=(await fs.readFile('project-store.cjs','utf8')).replace(/const ROOT = .*?;/,'const ROOT = '+JSON.stringify(root)+';');
  vm.runInNewContext(source,{module,console,Buffer,structuredClone,require:id=>{
   if(id==='./asset-transaction.cjs')return {...localRequire(id),commit:(base,writes)=>localRequire(id).commit(base,writes,async(stage,index)=>{if(fail&&stage==='applied'&&index===0)throw Error('history save injected failure');})};
   if(id==='./asset-naming.cjs')return {nameStoryboardAssets:async(...args)=>{const result=await localRequire(id).nameStoryboardAssets(...args);if(extra)args[2].set(extra.path,extra.bytes);return result;}};
   return localRequire(id);
  }});
  const state={projectSource:{path:file},nodes:[
   {id:'scene',kind:'shot',title:'场景01'},
   {id:'boardA',kind:'storyboard',title:'镜头01'},
   {id:'boardB',kind:'storyboard',title:'镜头02'},
   {id:'a',kind:'asset',assetPath:'assets/videos/a.mp4',projectPath:file},
   {id:'b',kind:'asset',assetPath:'assets/videos/b.mp4',projectPath:file}
  ],connections:[{fromId:'scene',toId:'boardA'},{fromId:'scene',toId:'boardB'},{fromId:'boardA',toId:'a'},{fromId:'boardB',toId:'b'}]};
  const apply=result=>{for(const asset of result.videoAssets)Object.assign(state.nodes.find(n=>n.id===asset.id),asset);};
  apply(await module.exports.save(file,state));
  const original=structuredClone(state),history=state.nodes.filter(n=>n.assetPath).map(n=>({projectPath:file,assetPath:n.assetPath}));
  // The normal geometry path with retained undo history still reads no media.
  const read=fs.readFile;let mediaReads=0;
  fs.readFile=async(target,...args)=>{if(String(target).startsWith(path.join(base,'assets')+path.sep))mediaReads++;return read(target,...args);};
  try {state.nodes[0].x=15;const result=await module.exports.save(file,state,history);assert.equal(result.historyAssets.length,0);}finally{fs.readFile=read;}
  assert.equal(mediaReads,0);
  state.nodes[1].title='镜头02';state.nodes[2].title='镜头01';
  const beforeJSON=await fs.readFile(file);
  fail=true;await assert.rejects(module.exports.save(file,state,history),/injected failure/);fail=false;
  assert.deepEqual(await fs.readFile(file),beforeJSON);
  assert.deepEqual(await fs.readFile(path.join(base,history[0].assetPath)),bytesA);
  assert.deepEqual(await fs.readFile(path.join(base,history[1].assetPath)),bytesB);
  assert.equal(await fs.stat(path.join(base,'assets/.undo')).then(()=>true,()=>false),false,'rollback leaves no acknowledged or published pins');
  const swapped=await module.exports.save(file,state,[...history,{projectPath:path.join(root,'other.json'),assetPath:history[0].assetPath}]);apply(swapped);
  assert.equal(swapped.historyAssets.length,2,'other project must remain untouched');
  const remap=(snapshot,mappings)=>{for(const node of snapshot.nodes){const mapping=mappings.find(m=>node.projectPath===m.projectPath&&node.assetPath===m.assetPath);if(mapping)node.assetPath=mapping.pinnedPath;}};
  remap(original,swapped.historyAssets);
  for(const [i,mapping] of swapped.historyAssets.entries())assert.deepEqual(await fs.readFile(path.join(base,mapping.pinnedPath)),i===0?bytesA:bytesB);
  const redo=structuredClone(state);
  const redoHistory=redo.nodes.filter(n=>n.assetPath).map(n=>({projectPath:file,assetPath:n.assetPath}));
  const undone=await module.exports.save(file,original,redoHistory);remap(redo,undone.historyAssets);
  for(const item of undone.videoAssets)assert.deepEqual(await fs.readFile(path.join(base,item.assetPath)),item.id==='a'?bytesA:bytesB);
  const redone=await module.exports.save(file,redo,original.nodes.filter(n=>n.assetPath).map(n=>({projectPath:file,assetPath:n.assetPath})));
  for(const item of redone.videoAssets)assert.deepEqual(await fs.readFile(path.join(base,item.assetPath)),item.id==='a'?bytesA:bytesB);
  assert.equal(redone.historyAssets.length,0,'immutable historical paths need no second copy');
  // Rename retires the source after its historical bytes have committed.
  apply(redone);state.nodes[1].title='镜头03';
  const old=state.nodes.find(n=>n.id==='a').assetPath;
  const renamed=await module.exports.save(file,state,[{projectPath:file,assetPath:old}]);apply(renamed);
  assert.equal(renamed.historyAssets.length,1);
  assert.deepEqual(await fs.readFile(path.join(base,renamed.historyAssets[0].pinnedPath)),bytesA);
  assert.equal(await fs.stat(path.join(base,old)).then(()=>true,()=>false),false);
  // Exercise audio's semantic WebM path with an actual transactional overwrite.
  const audioPath='assets/audio/voice.webm',audioBytes=Buffer.from('audio history');
  await fs.mkdir(path.join(base,'assets/audio'),{recursive:true});await fs.writeFile(path.join(base,audioPath),audioBytes);
  extra={path:audioPath,bytes:Buffer.from('new audio')};state.nodes[1].title='镜头04';
  const audio=await module.exports.save(file,state,[{projectPath:file,assetPath:audioPath}]);
  assert.equal(audio.historyAssets[0].pinnedPath,'assets/.undo/audio/'+createHash('sha256').update(audioBytes).digest('hex')+'.webm');
  assert.deepEqual(await fs.readFile(path.join(base,audio.historyAssets[0].pinnedPath)),audioBytes);
  apply(audio);extra=null;state.nodes[1].title='镜头05';
  const unchangedSource=state.nodes.find(n=>n.id==='b').assetPath;
  const equal=await module.exports.save(file,state,[{projectPath:file,assetPath:unchangedSource}]);apply(equal);
  assert.equal(equal.historyAssets.length,0,'a full naming pass with identical destination bytes needs no pin');
  const duplicates=['assets/videos/old1.mp4','assets/videos/old2.mp4'];
  for(const duplicate of duplicates)await fs.writeFile(path.join(base,duplicate),bytesA);
  state.nodes.push(...duplicates.map((assetPath,i)=>({id:'duplicate'+i,kind:'asset',assetPath,projectPath:file})));
  const dedup=await module.exports.save(file,state,duplicates.map(assetPath=>({projectPath:file,assetPath})));
  assert.equal(dedup.historyAssets.length,2);
  assert.equal(dedup.historyAssets[0].pinnedPath,dedup.historyAssets[1].pinnedPath,'identical retired history shares one content-addressed copy');
  // After commit an optional marker failure must still deliver the remappings.
  apply(dedup);state.nodes[1].title='镜头06';
  const markerHistory=[{projectPath:file,assetPath:state.nodes.find(n=>n.id==='a').assetPath}];
  const originalWrite=fs.writeFile;
  fs.writeFile=async(target,...args)=>{if(String(target)===path.join(root,'.last-project.json.writing'))throw Error('optional marker failure');return originalWrite(target,...args);};
  let markerResult;try{markerResult=await module.exports.save(file,state,markerHistory);}finally{fs.writeFile=originalWrite;}
  assert.equal(markerResult.historyAssets.length,1,'committed remaps cannot be hidden by marker failure');
  console.log('History asset save: zero-read moves, transactional rollback, swap undo/redo, rename cleanup, project isolation, audio WebM passed');
 } finally {await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
