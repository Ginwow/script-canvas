// Isolated renderer history test. Executes the actual app.js functions, with fake DOM/disk.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
let releases=[],writes=0;
const title={textContent:'A'},body={textContent:'body'};
const node={dataset:{id:'one',kind:'text',x:'0',y:'0'},className:'node',getAttribute:()=>null,removeAttribute(){},setAttribute(){},querySelector:s=>s==='.node-title'?title:s==='.node-body'?body:null};
const layer={children:[node],replaceChildren(){this.children=[];},append(el){this.children.push(el);}};
const context={console,queueMicrotask,Map,Set,JSON,Promise,nodesLayer:layer,connections:[],
 window:{canvasFiles:{saveManagedProject:()=>{writes++;return new Promise(resolve=>releases.push(()=>resolve({ok:true})));}}},
 localStorage:{setItem(){}},SAVE_KEY:'test',scheduleQuickSync(){},setSaveStatus(){},toast(){},
 getBodyText:el=>el.textContent,setBodyText:(el,text)=>{el.textContent=text;},applyView(){},renderConnections(){},
 isValidCodexConversation:()=>false,nodeDeletionPending:false,
 importedProjectPath:'P',importedCodexConversation:null,importedProjectFingerprint:'',importedCanvasFingerprint:'',view:{x:0,y:0,scale:1},shotLaneLayoutVersion:2,
 getNode:id=>layer.children.find(n=>n.dataset.id===id),isCanvasVideoFile:()=>false};
context.window.CanvasManualLayout=require('../canvas-layout.js');
vm.createContext(context);
vm.runInContext(section('      function canvasRecords()','      function fingerprintText('),context);
node.classList={contains:()=>false};
vm.runInContext(section('      let canvasSaveQueue=','      const canvasNodeIndex =')+section('      const canvasUndoStack =','      function validateImageReference(')+section('      function captureCanvasSnapshot()','      function defaultProjectPosition(')+`
 globalThis.api={save,beginManualCanvasLayout,finishManualCanvasLayout,recordCanvasLayoutChange,beginCanvasAction,endCanvasAction,runCanvasAction,undoLastCanvasChange,redoLastCanvasChange,recordCanvasUndo,canvasHistoryAssetReferences,rewriteCanvasHistoryAssets,canvasHistorySnapshots,
 counts:()=>[canvasUndoStack.length,canvasRedoStack.length],init:()=>refreshCanvasUndoCheckpoint(),signature:()=>canvasUndoSignature};`,context);
const api=context.api;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function flush(){for(let i=0;i<30;i++){await tick();if(releases.length){const pending=releases;releases=[];pending.forEach(release=>release());}else{await tick();if(!releases.length)return;}}throw Error('save queue did not settle');}
async function main(){
 api.init();
 title.textContent='B';const one=api.save();title.textContent='C';const two=api.save();
 assert.deepEqual([...api.counts()],[2,0],'separate mutations must survive queued saves');
 await flush();await Promise.all([one,two]);
 context.view={x:333,y:444,scale:2};
 const undo=api.undoLastCanvasChange();await flush();await undo;
 assert.equal(title.textContent,'B');assert.equal(context.view.x,333,'undo keeps current viewport');
 assert.deepEqual([...api.counts()],[1,1],'restore save must never append undo');
 const redo=api.redoLastCanvasChange();await flush();await redo;
 assert.equal(title.textContent,'C');assert.deepEqual([...api.counts()],[2,0]);
 const u2=api.undoLastCanvasChange();await flush();await u2;
 title.textContent='D';const branch=api.save();assert.equal(api.counts()[1],0,'new changes clear redo');await flush();await branch;
 const before=api.counts()[0],token=api.beginCanvasAction('typing');
 title.textContent='D1';api.save();title.textContent='D2';api.save();
 const nested=api.beginCanvasAction('nested');title.textContent='D3';api.save();api.endCanvasAction(nested);
 assert.equal(api.counts()[0],before);api.endCanvasAction(token);assert.equal(api.counts()[0],before+1);
 await flush();const grouped=api.undoLastCanvasChange();await flush();await grouped;assert.equal(title.textContent,'D');
 const noOp=api.beginCanvasAction('click');api.endCanvasAction(noOp);assert.equal(api.counts()[1],1,'no-op action retains redo');
 let partial=api.runCanvasAction('partial import',async()=>{title.textContent='partial';await api.save();throw Error('second item failed');}).catch(e=>e.message);
 await flush();assert.equal(await partial,'second item failed');assert.equal(api.counts()[1],0);
 const layoutWrites=writes,layoutAction=api.beginCanvasAction('layout'),layoutToken=api.beginManualCanvasLayout();
 node.dataset.x='88';node.dataset.autoPosition='false';api.finishManualCanvasLayout(layoutToken);api.endCanvasAction(layoutAction);api.recordCanvasLayoutChange();
 await api.undoLastCanvasChange();assert.equal(node.dataset.x,'0');assert.equal(writes,layoutWrites,'layout-only undo cannot write');
 await api.redoLastCanvasChange();assert.equal(node.dataset.x,'88');assert.equal(writes,layoutWrites,'layout-only redo cannot write');
 title.textContent='after layout';const layoutAuto=api.save();await flush();await layoutAuto;
 const explicit=api.save({strict:true,manualLayout:true});await flush();await explicit;
 const layoutUndo=api.undoLastCanvasChange();await flush();await layoutUndo;
 node.dataset.projectPath='p';node.dataset.assetPath='assets/old.png';api.init();
 const request=api.canvasHistorySnapshots(),record=request.at(-1).nodes[0];
 title.textContent='edit while renaming';const inFlight=api.save();
 const newer=api.canvasHistorySnapshots().at(-1).nodes[0];
 const later={nodes:[{data:{projectPath:'p',assetPath:'assets/old.png'}}]};
 api.rewriteCanvasHistoryAssets([{projectPath:'P',assetPath:'assets/old.png',pinnedPath:'assets/.undo/hash.png'}],request);
 assert.equal(record.data.assetPath,'assets/.undo/hash.png');assert.equal(newer.data.assetPath,'assets/.undo/hash.png','same immutable node snapshots created during save must follow pin mapping');assert.equal(later.nodes[0].data.assetPath,'assets/old.png');
 await flush();await inFlight;
 node.dataset.assetPath='assets/input.png';node.dataset.projectPath='P';
 api.init();
 context.window.canvasFiles.saveManagedProject=async()=>({ok:true,videoAssets:[{id:'one',assetPath:'assets/canonical.png',projectPath:'P',fileName:'canonical.png'}]});
 title.textContent='normalize';await api.save();
 const normalizedSteps=api.counts()[0];await api.save();
 assert.equal(api.counts()[0],normalizedSteps,'save path normalization must not create a phantom edit');
 console.log(`PASS actual renderer history: queue, undo/redo, viewport, branch, nested actions, partial failure, request-scoped asset remapping (${writes} isolated writes)`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
