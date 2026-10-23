const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app.js','utf8');
const section=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
let records=[{id:'n1',kind:'storyboard',x:1,y:2,title:'镜头01',text:'original',collapsed:false,imageZoom:1}],action='save',callback,saves=0,finishes=[],fail=false;
const context=vm.createContext({JSON,importedProjectPath:'project',connections:[],recordCanvasUndo:()=>{},canvasRecords:()=>records,imageZoomSaveTimer:null,canvasSaveQueue:Promise.resolve(),document:{activeElement:{blur(){}}},toast(){},window:{canvasFiles:{onPrepareClose:fn=>callback=fn,confirmCloseChanges:async()=>({action}),finishClose:async payload=>finishes.push(payload)}},save:async options=>{assert.equal(options.strict,true);saves++;if(fail)throw Error('disk failed');}});
context.window.CanvasManualLayout=require('../canvas-layout.js');
vm.runInContext(section('      let canvasContentObserved=', '      let pendingAutomaticSave='),context);
vm.runInContext(section('      function initSaveOnClose()', "      fileInput.addEventListener('change'"),context);
const changed=()=>vm.runInContext('canvasContentChanged',context);
(async()=>{
  context.resetCanvasContentTracking();records[0].x++;context.recordCanvasLayoutChange();assert.equal(changed(),false);assert.equal(saves,0,'layout changes stay silent and do not save');
  context.resetCanvasContentTracking();
  records[0].collapsed=true;records[0].childrenCollapsed=true;records[0].imageZoom=3;records[0].imagePanX=20;
  assert.equal(context.observeCanvasContentChange(),false);assert.equal(changed(),false);
  records[0].assetPath='normalized.png';records[0].fileName='normalized.png';assert.equal(context.observeCanvasContentChange(),false,'filename normalization is bookkeeping');
  context.initSaveOnClose();await callback();assert.equal(saves,0);assert.equal(finishes.at(-1).ok,true);
  for(const mutate of [()=>records[0].text+=' edited',()=>records.push({id:'n2',kind:'asset'}),()=>records.pop(),()=>context.connections.push({fromId:'n1',toId:'n2'})]){
    context.resetCanvasContentTracking();mutate();assert.equal(context.observeCanvasContentChange(),true);assert.equal(changed(),true);context.observeCanvasContentChange();assert.equal(changed(),true,'autosave does not acknowledge changes');
  }
  action='save';await callback();assert.equal(saves,1);assert.equal(finishes.at(-1).ok,true);
  action='discard';await callback();assert.equal(saves,1);assert.equal(finishes.at(-1).ok,true);
  action='cancel';await callback();assert.equal(finishes.at(-1).cancelled,true);assert.equal(saves,1);
  action='save';fail=true;await callback();assert.equal(finishes.at(-1).ok,false);assert.match(finishes.at(-1).error,/disk failed/);
  context.resetCanvasContentTracking();records[0].x+=10;context.acknowledgeCanvasViewChange();assert.equal(context.observeCanvasContentChange(),false,'automatic positions from folding remain viewing-only');
  assert(!section("          head.addEventListener('click'", "          if (kind === 'asset') {").includes('save();'));
  assert(!section('      function zoomImageByWheel(', '      function imagePanBounds(').includes('save('));
  console.log('PASS close content: view/layout silent, add/delete/text/edges dirty, autosave retains reminder, save/discard/cancel/error, folding layout bookkeeping');
})().catch(error=>{console.error(error);process.exitCode=1;});
