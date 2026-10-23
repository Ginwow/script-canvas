const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {commit,recover}=require('../asset-transaction.cjs');
const {nameStoryboardAssets}=require('../asset-naming.cjs');
async function fixture(t){const base=await fs.mkdtemp(path.join(os.tmpdir(),'canvas-save-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));return base;}
test('failure after any replacement restores all asset and JSON bytes',async t=>{
 for(const failIndex of [0,1,2]){
 const base=await fixture(t);await fs.writeFile(path.join(base,'a'),'old-a');await fs.writeFile(path.join(base,'project.json'),'old-json');
 await assert.rejects(commit(base,new Map([['a',Buffer.from('new-a')],['new-asset',Buffer.from('new')],['project.json',Buffer.from('new-json')]]),async(stage,index)=>{if(stage==='applied'&&index===failIndex)throw Error('injected');}),/injected/);
 assert.equal(await fs.readFile(path.join(base,'a'),'utf8'),'old-a');assert.equal(await fs.readFile(path.join(base,'project.json'),'utf8'),'old-json');await assert.rejects(fs.access(path.join(base,'new-asset')));
 }
});
test('process interruption journal recovers on next access',async t=>{
 const base=await fixture(t);await fs.writeFile(path.join(base,'a'),'old');await fs.writeFile(path.join(base,'project.json'),'old-json');
 const code=`require(${JSON.stringify(require.resolve('../asset-transaction.cjs'))}).commit(${JSON.stringify(base)},new Map([['a',Buffer.from('new')],['project.json',Buffer.from('new-json')]]),async(s,i)=>{if(s==='applied'&&i===0)process.exit(7)})`;
 assert.equal(spawnSync(process.execPath,['-e',code]).status,7);await recover(base);await recover(base);
 assert.equal(await fs.readFile(path.join(base,'a'),'utf8'),'old');assert.equal(await fs.readFile(path.join(base,'project.json'),'utf8'),'old-json');
});
test('same numbered boards preserve distinct videos and prompt exports',async t=>{
 const base=await fixture(t);await fs.mkdir(path.join(base,'assets/videos'),{recursive:true});
 for(const name of ['a','b'])await fs.writeFile(path.join(base,'assets/videos',name+'.mp4'),name);
 const nodes=[{id:'s',kind:'shot',title:'场景01'},...['a','b'].flatMap(id=>[{id:'board'+id,kind:'storyboard',title:'镜头01'},{id:'p'+id,kind:'prompt',text:id},{id,kind:'asset',assetPath:'assets/videos/'+id+'.mp4'}])];
 const connections=['a','b'].flatMap(id=>[{fromId:'s',toId:'board'+id},{fromId:'board'+id,toId:'p'+id},{fromId:'p'+id,toId:id}]);
 const state={nodes,connections,projectSource:{path:path.join(base,'project.json')}},writes=new Map();await nameStoryboardAssets(base,state,writes);
 assert.equal(writes.size,4);assert.equal(new Set([...writes.keys()].map(p=>p.toLowerCase())).size,4);assert.notEqual(nodes.find(n=>n.id==='a').assetPath,nodes.find(n=>n.id==='b').assetPath);
 assert.equal(await fs.readFile(path.join(base,'assets/videos/a.mp4'),'utf8'),'a');
});
test('character names differing only by case keep separate image destinations',async t=>{
 const base=await fixture(t);await fs.mkdir(path.join(base,'assets/generated'),{recursive:true});
 // Naming treats unsupported image encodings byte-for-byte, as png-storage does.
 await fs.writeFile(path.join(base,'assets/generated/one.png'),'first-image');await fs.writeFile(path.join(base,'assets/generated/two.png'),'second-image');
 const state={projectSource:{path:path.join(base,'project.json')},nodes:[{id:'c1',kind:'character',title:'Alice'},{id:'c2',kind:'character',title:'alice'},{id:'i1',kind:'asset',assetPath:'assets/generated/one.png'},{id:'i2',kind:'asset',assetPath:'assets/generated/two.png'}],connections:[{fromId:'c1',toId:'i1'},{fromId:'c2',toId:'i2'}]};
 const writes=new Map();await nameStoryboardAssets(base,state,writes);
 assert.equal(writes.size,2);assert.equal(new Set([...writes.keys()].map(p=>p.toLowerCase())).size,2);
 assert.deepEqual(new Set([...writes.values()].map(b=>b.toString())),new Set(['first-image','second-image']));
});
test('successful save commits asset and JSON together and removes journal',async t=>{
 const base=await fixture(t);await fs.writeFile(path.join(base,'a'),'old');
 await commit(base,new Map([['a',Buffer.from('new')],['project.json',Buffer.from('json')]]));await recover(base);
 assert.equal(await fs.readFile(path.join(base,'a'),'utf8'),'new');assert.equal(await fs.readFile(path.join(base,'project.json'),'utf8'),'json');await assert.rejects(fs.access(path.join(base,'.canvas-save-transaction')));
});
test('reads run during preparation and wait through asset plus JSON publication',async t=>{
 const {withStableRead}=require('../asset-transaction.cjs');const base=await fixture(t);
 await fs.writeFile(path.join(base,'a'),'old');await fs.writeFile(path.join(base,'project.json'),'old-json');
 let preparedResolve,continueResolve,appliedResolve,publishResolve;
 const prepared=new Promise(r=>preparedResolve=r),proceed=new Promise(r=>continueResolve=r),applied=new Promise(r=>appliedResolve=r),publish=new Promise(r=>publishResolve=r);
 const saving=commit(base,new Map([['a',Buffer.from('new')],['project.json',Buffer.from('new-json')]]),async(s,i)=>{if(s==='prepared'){preparedResolve();await proceed;}if(s==='applied'&&i===0){appliedResolve();await publish;}});
 await prepared;assert.equal(await withStableRead(base,()=>fs.readFile(path.join(base,'a'),'utf8')),'old');continueResolve();await applied;
 let readFinished=false;const reading=withStableRead(base,async()=>{const result=await Promise.all(['a','project.json'].map(f=>fs.readFile(path.join(base,f),'utf8')));readFinished=true;return result;});
 await new Promise(r=>setImmediate(r));assert.equal(readFinished,false);publishResolve();await saving;assert.deepEqual(await reading,['new','new-json']);
});
test('recovery removes interrupted staging before manifest publication',async t=>{
 const base=await fixture(t),journal=path.join(base,'.canvas-save-transaction');await fs.mkdir(journal);await fs.writeFile(path.join(journal,'0.new'),'staged');await fs.writeFile(path.join(base,'project.json'),'original');
 await recover(base);await assert.rejects(fs.access(journal));assert.equal(await fs.readFile(path.join(base,'project.json'),'utf8'),'original');
});


test('recovery removes retired journals left by interrupted cleanup',async t=>{
 const base=await fixture(t),retired=path.join(base,'.canvas-save-transaction.completed-12345678-1234-1234-1234-123456789abc');
 await fs.mkdir(retired);await fs.writeFile(path.join(retired,'0.old'),'backup');
 await recover(base);await assert.rejects(fs.access(retired));
});
