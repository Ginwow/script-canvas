// Exercise the actual renderer queue/persistence functions without opening an app.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
const queueSource=source.slice(source.indexOf('      let canvasSaveQueue='),source.indexOf('      const canvasNodeIndex ='));
function harness(){
  const writes=[],history=[],mappings=[],statuses=[];let text='initial',prunes=0;
  const context={Promise,console,importedProjectPath:'P',importedCodexConversation:null,importedProjectFingerprint:'',importedCanvasFingerprint:'',view:{x:0,y:0,scale:1},shotLaneLayoutVersion:2,connections:[],nodeDeletionPending:false,
    canvasRecords:()=>[{id:'one',title:text,assetPath:'',projectPath:''}],recordCanvasUndo:state=>history.push(state.nodes[0].title),
    scheduleQuickSync(){},setSaveStatus:(...args)=>statuses.push(args),pruneUndoHistory:async()=>{prunes++;},
    localStorage:{setItem(){}},SAVE_KEY:'test',toast(){},canvasUndoSignature:'unchanged',canvasUndoStateSignature:()=> 'unchanged',
    canvasHistorySnapshots:()=>history.slice(),canvasHistoryAssetReferences:snapshots=>snapshots.slice(),
    rewriteCanvasHistoryAssets:(assets,snapshots)=>mappings.push({assets,snapshots}),normalizeCanvasUndoCheckpoint(){},refreshCanvasUndoCheckpoint(){},
    getNode:()=>null,isCanvasVideoFile:()=>false,
    window:{canvasFiles:{saveManagedProject:request=>new Promise((resolve,reject)=>writes.push({request,resolve,reject}))}}};
  context.window.CanvasManualLayout=require('../canvas-layout.js');
  vm.createContext(context);vm.runInContext(queueSource+'\nglobalThis.api={save,drain:()=>canvasSaveQueue};',context);
  return {context,writes,history,mappings,statuses,api:context.api,edit:value=>{text=value;},prunes:()=>prunes};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function complete(h,index,result={ok:true}){h.writes[index].resolve(result);await tick();}
async function main(){
  const h=harness(),promises=[];
  for(let i=0;i<100;i++){h.edit('burst'+i);promises.push(h.api.save());}
  assert.equal(h.history.length,100,'coalescing must retain every mutation boundary');
  assert.equal(new Set(promises).size,1,'pending automatic requests share one operation');
  await tick();assert.equal(h.writes.length,1);assert.equal(h.writes[0].request.state.nodes[0].title,'burst99');
  for(let i=0;i<100;i++){h.edit('during'+i);promises.push(h.api.save());}
  const drain=h.api.drain();let drained=false;drain.then(()=>{drained=true;});
  await complete(h,0,{ok:true,historyAssets:[{assetPath:'old',pinnedPath:'new'}]});
  assert.equal(drained,false,'queue consumers must wait for trailing write');assert.equal(h.writes.length,2);
  assert.equal(h.writes[1].request.state.nodes[0].title,'during99');assert.equal(h.mappings[0].snapshots.length,100,'pin mappings keep execution request snapshots');
  await complete(h,1);await Promise.all(promises);await drain;assert.equal(h.prunes(),2);assert.equal(h.history.length,200);

  const b=harness();b.edit('automatic');const auto=b.api.save();const strict=b.api.save({strict:true});b.edit('after barrier');const after=b.api.save();
  assert.notEqual(auto,strict);assert.notEqual(strict,after);await tick();await complete(b,0);assert.equal(b.writes.length,2);
  // Attach a handler before rejecting: strict errors reach their caller, while the queue continues.
  const strictResult=strict.then(()=>null,error=>error.message);b.writes[1].reject(Error('strict failure'));await tick();
  assert.equal(await strictResult,'strict failure');assert.equal(b.writes.length,3);await complete(b,2);await Promise.all([auto,after,b.api.drain()]);
  assert.ok(b.statuses.some(([status])=>status==='error'));

  const e=harness();const first=e.api.save();await tick();const trailing=e.api.save();e.writes[0].reject(Error('automatic failure'));await tick();
  await first;assert.equal(e.writes.length,2,'failed automatic write must not block later saves');await complete(e,1);await trailing;
  const count=e.history.length;const restore=e.api.save({skipUndo:true,strict:true});const following=e.api.save();await tick();
  assert.equal(e.history.length,count+1,'restoration skips undo while following mutation records');await complete(e,2);await complete(e,3);await Promise.all([restore,following]);

  const p=harness();const old=p.api.save();p.context.importedProjectPath='Q';const changed=p.api.save();assert.notEqual(old,changed,'never merge pending requests across project identity');
  await tick();await complete(p,0);await complete(p,1);await Promise.all([old,changed]);
  console.log('PASS actual save queue: 200 edits / 2 writes, pending and inflight bursts, drain, strict barriers/failure, automatic failure recovery, restore history, mapping snapshots, project boundary');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
