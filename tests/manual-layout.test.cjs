const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {createTracker}=require('../canvas-layout.js');
const clone=value=>JSON.parse(JSON.stringify(value));
const node=(id='a',x=0)=>({id,kind:'text',x,y:0,width:null,height:null,autoPosition:'auto',text:''});
function gesture(tracker,records,change){const token=tracker.begin(records);change();tracker.finish(token,records);}

test('moves, resizes and followers remain pending across repeated content saves and automatic lane shifts',()=>{
  const tracker=createTracker(),records=[node(),node('b',100)];
  gesture(tracker,records,()=>{records[0].x=20;records[0].width=400;records[0].height=200;records[0].autoPosition='';records[1].x=120;});
  records[0].text='content';
  assert.deepEqual(tracker.project(records).map(n=>[n.x,n.width,n.height,n.autoPosition]),[[0,null,null,'auto'],[100,null,null,'auto']]);
  gesture(tracker,records,()=>{records[0].x=40;records[0].width=600;records[1].x=140;});
  records.forEach(n=>{n.x+=50;}); // a structural content action shifts the lane
  assert.deepEqual(tracker.project(records).map(n=>n.x),[50,150]);
  assert.equal(tracker.project(records)[0].width,null);
  assert.equal(tracker.project(records,true)[0].width,600);
});

test('active gestures mask partial geometry and cancellation after DOM rollback retains prior pending layout',()=>{
  const tracker=createTracker(),records=[node()];
  gesture(tracker,records,()=>{records[0].x=20;});
  const token=tracker.begin(records);records[0].x=90;records[0].width=500;
  assert.equal(tracker.project(records)[0].x,0);
  assert.equal(tracker.project(records)[0].width,null);
  records[0].x=20;records[0].width=null;tracker.finish(token,records,{cancelled:true});
  assert.equal(tracker.project(records)[0].x,0);
});

test('successful manual commit acknowledges only its snapshot, including newer in-flight movement and resize',()=>{
  const tracker=createTracker(),records=[node()];
  gesture(tracker,records,()=>{records[0].x=20;records[0].width=400;});
  const commit=tracker.captureCommit(records);
  gesture(tracker,records,()=>{records[0].x=30;records[0].width=600;});
  tracker.commit(commit);
  assert.equal(tracker.project(records)[0].x,20);
  assert.equal(tracker.project(records)[0].width,400);
  const active=tracker.begin(records);records[0].x=80;
  const second=tracker.captureCommit([{...records[0],x:30}]);
  tracker.commit(second);tracker.finish(active,records);
  assert.equal(tracker.project(records)[0].x,30);
});

test('undo snapshots reconcile with successful manual saves, and node deletion/restoration retains ID identity',()=>{
  const tracker=createTracker(),records=[node()];
  const original=tracker.capture(),originalRecords=clone(records);
  gesture(tracker,records,()=>{records[0].x=20;records[0].width=400;});
  const moved=tracker.capture();tracker.commit(tracker.captureCommit(records));
  tracker.restore(original,originalRecords);
  assert.equal(tracker.project(originalRecords)[0].x,20);
  assert.equal(tracker.project(originalRecords)[0].width,400);
  tracker.restore(moved,records);
  assert.equal(tracker.project(records)[0].x,20);
  assert.deepEqual(tracker.project([]),[]);
  assert.equal(tracker.project([node('new',300)])[0].x,300);
  tracker.reset();assert.equal(tracker.project(originalRecords)[0].x,0);
});

test('queued manual acknowledgments and automatic snapshots rebase against earlier successful saves',()=>{
  const tracker=createTracker(),records=[node()];
  gesture(tracker,records,()=>{records[0].x=20;});
  const first=tracker.captureCommit(records),second=tracker.captureCommit(records);
  const automatic=tracker.project(records),revision=tracker.capture();
  tracker.commit(first);tracker.commit(second);
  assert.equal(tracker.project(records)[0].x,20);
  assert.equal(tracker.rebase(automatic,revision)[0].x,20);
});

function harness(){
  let records=[node()],fail=false,hold=null;
  const writes=[],cache=[];
  const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
  const region=source.slice(source.indexOf('      const manualCanvasLayout='),source.indexOf('      const canvasNodeIndex'));
  const context={window:{CanvasManualLayout:{createTracker},canvasFiles:{saveManagedProject:async payload=>{
    writes.push(clone(payload.state));if(hold)await hold;if(fail)return {ok:false,error:'injected'};return {ok:true};
  }}},localStorage:{setItem:(_key,value)=>cache.push(JSON.parse(value))},SAVE_KEY:'canvas',
  view:{x:0,y:0,scale:1},connections:[],shotLaneLayoutVersion:1,importedProjectPath:'test.json',
  importedCodexConversation:null,importedProjectFingerprint:'',importedCanvasFingerprint:'',
  canvasRecords:()=>clone(records),observeCanvasContentChange(){},recordCanvasUndo(){},scheduleQuickSync(){},
  setSaveStatus(){},toast(){},canvasSaveQueue:Promise.resolve(),nodeDeletionPending:false,
  pruneUndoHistory:async()=>{},canvasHistorySnapshots:()=>[],canvasHistoryAssetReferences:()=>[],
  canvasUndoStateSignature:()=>'',canvasUndoSignature:'',rewriteCanvasHistoryAssets(){},getNode:()=>null,
  normalizeCanvasUndoCheckpoint(){},refreshCanvasUndoCheckpoint(){}};
  const api=vm.runInNewContext(region+'\n({save,beginManualCanvasLayout,finishManualCanvasLayout});',context);
  return {...api,writes,cache,get records(){return records;},set records(value){records=value;},set fail(value){fail=value;},set hold(value){hold=value;}};
}

test('all automatic and strict persistence projects layout; manual failures leave disk baseline/cache intact',async()=>{
  const app=harness();await app.save();
  const token=app.beginManualCanvasLayout();app.records[0].x=20;app.records[0].width=400;app.finishManualCanvasLayout(token);
  app.records[0].text='content';await app.save();await app.save({strict:true});
  assert.equal(app.writes.at(-1).nodes[0].x,0);assert.equal(app.cache.at(-1).nodes[0].x,0);
  assert.equal(app.writes.at(-1).nodes[0].text,'content');
  app.fail=true;await assert.rejects(app.save({strict:true,manualLayout:true}),/injected/);
  assert.equal(app.cache.at(-1).nodes[0].x,0);
  app.fail=false;await app.save({strict:true});assert.equal(app.writes.at(-1).nodes[0].x,0);
  await app.save({strict:true,manualLayout:true});assert.equal(app.cache.at(-1).nodes[0].x,20);
  await app.save();assert.equal(app.writes.at(-1).nodes[0].x,20);
});

test('saving during drag masks partial layout and queued content saves do not revert a completed CtrlS',async()=>{
  const app=harness();await app.save();
  let token=app.beginManualCanvasLayout();app.records[0].x=20;
  await app.save();assert.equal(app.writes.at(-1).nodes[0].x,0);
  app.finishManualCanvasLayout(token);
  let release;app.hold=new Promise(resolve=>{release=resolve;});
  const manual=app.save({strict:true,manualLayout:true});await new Promise(resolve=>setImmediate(resolve));
  token=app.beginManualCanvasLayout();app.records[0].x=40;app.finishManualCanvasLayout(token);
  app.records[0].text='later content';const automatic=app.save();
  app.hold=null;release();await manual;await automatic;
  assert.equal(app.writes.at(-1).nodes[0].x,20);
  assert.equal(app.writes.at(-1).nodes[0].text,'later content');
  assert.equal(app.cache.at(-1).nodes[0].x,20);
  assert.equal(app.records[0].x,40);
});
