// Isolated regression tests: run actual renderer functions with in-memory DOM/IPC stubs.
// No Electron launch, clipboard access, or project writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app.js'), 'utf8').replace(/\r\n/g, '\n');
function fn(name) {
  const match = new RegExp(`^      (?:async )?function ${name}\\(`, 'm').exec(source);
  assert.ok(match, name);
  const start = match.index, lineEnd = source.indexOf('\n', start);
  if (source.slice(start, lineEnd).trimEnd().endsWith('}')) return source.slice(start, lineEnd);
  const end = source.indexOf('\n      }', lineEnd);
  assert.ok(end > start, name + ' end');
  return source.slice(start, end + 8);
}
function listener(startText, endText) {
  const start = source.indexOf(startText), end = source.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, startText);
  return source.slice(start, end);
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const node = (id, kind, extra = {}) => ({ dataset: {id, kind, x:'0', y:'0', ...extra}, offsetWidth:100, classList:{add(){},remove(){}}, querySelector(){return null;} });
async function main() {
  const created=[], persisted=[], connections=[], character=node('character','character');
  const audioContext=vm.createContext({ importedProjectPath:'test.json', connections, shotLaneLayoutVersion:0,
    runCanvasAction:async(_label,callback)=>callback(),
    window:{canvasFiles:{getPathForFile:()=>'/voice.mp3',importAudio:async()=>({ok:true,name:'voice.mp3',assetPath:'assets/audio/voice.mp3',projectPath:'test.json'})}},
    getNode:id=>id==='character'?character:null, makeNode:(kind,x,y,options)=>{const n=node('audio',kind,options);created.push(n);return n;},
    selectNode(){},renderConnections(){},save:async()=>persisted.push(JSON.parse(JSON.stringify({created,connections}))),toast:message=>{assert.ok(!/失败/.test(message),message);}
  });
  vm.runInContext(fn('importCanvasAudio'),audioContext);
  await audioContext.importCanvasAudio([{name:'voice.mp3'}],{x:1,y:2},character);
  assert.equal(persisted.length,1);
  assert.equal(persisted[0].created[0].dataset.assetPath,'assets/audio/voice.mp3');
  assert.equal(persisted[0].connections[0].fromId,'character');

  const calls=[], handlers={};let importActions=0;
  const dropContext=vm.createContext({ window:{addEventListener:(name,cb)=>handlers[name]=cb}, dragDepth:0,
    runCanvasAction:async(_label,callback)=>{importActions++;return callback();},
    dropOverlay:{classList:{remove(){}}}, clearExternalImageDropTarget(){},fileDropFeedback:()=>({target:character,valid:true}),
    worldPoint:(x,y)=>({x,y}),importCanvasImages:async files=>calls.push(['image',files.length]),importCanvasAudio:async files=>calls.push(['audio',files.length]),importCanvasVideos:async files=>calls.push(['video',files.length]),toast:message=>{throw Error(message);}
  });
  for(const name of ['isCanvasAudioFile','isCanvasImageFile','isCanvasVideoFile'])vm.runInContext(fn(name),dropContext);
  vm.runInContext(listener("      window.addEventListener('drop', e => {", "      window.addEventListener('dragend'"),dropContext);
  handlers.drop({dataTransfer:{files:[{name:'a.jpg',type:'image/jpeg'},{name:'a.mp4',type:'video/mp4'},{name:'a.mp3',type:'audio/mpeg'}]},preventDefault(){},clientX:0,clientY:0});
  await settle();
  assert.deepEqual(calls,[['image',1],['audio',1],['video',1]]);
  assert.equal(importActions,1,'Mixed drop must run every media type inside one outer action');
  calls.length=0;
  vm.runInContext(fn('importFiles'),dropContext);
  await dropContext.importFiles([{name:'a.jpg',type:'image/jpeg'},{name:'a.webm',type:'audio/webm'}],0,0);
  assert.deepEqual(calls,[['image',1],['audio',1]]);
  assert.equal(importActions,2,'Mixed file import must also have a shared outer action');

  let undo=0, redo=0, adds=0, picks=0;
  const keyContext=vm.createContext({window:{addEventListener:(name,cb)=>handlers[name]=cb},quickOverlay:{hidden:true},document:{querySelector:()=>null},toast(){},undoLastCanvasChange:()=>undo++,redoLastCanvasChange:()=>redo++,addAt:()=>adds++,fileInput:{click:()=>picks++}});
  vm.runInContext(listener("      window.addEventListener('keydown', e => {\n        if (!quickOverlay.hidden", "      window.addEventListener('resize'"),keyContext);
  const key=(k,flags={})=>handlers.keydown({key:k,target:{tagName:'DIV'},preventDefault(){},...flags});
  key('z',{ctrlKey:true,shiftKey:true}); assert.equal(undo,0);assert.equal(redo,1);
  key('y',{ctrlKey:true});assert.equal(redo,2);
  key('z',{ctrlKey:true}); assert.equal(undo,1);
  for(const k of ['n','s','i'])for(const flag of ['ctrlKey','metaKey','altKey','shiftKey','repeat'])key(k,{[flag]:true});
  assert.equal(adds,0); assert.equal(picks,0);
  for(const k of ['n','s','i'])key(k);
  assert.equal(adds,2); assert.equal(picks,1);

  let focus=0, capture;
  const focusContext=vm.createContext({window:{addEventListener:(_name,cb,options)=>{handlers.pointerdown=cb;capture=options.capture;}},viewport:{contains:()=>true,focus:()=>focus++},quickPanel:{contains:()=>false},canvasPastePoint:null});
  vm.runInContext(listener("      window.addEventListener('pointerdown', event => {\n        if(!viewport.contains", '      function hoveredImageNode'),focusContext);
  assert.equal(capture,true,'Focus must run in window capture before viewport capture can stop propagation');
  handlers.pointerdown({target:{closest:()=>null},altKey:true,clientX:1,clientY:2});assert.equal(focus,1);
  handlers.pointerdown({target:{closest:()=>({})},clientX:1,clientY:2});assert.equal(focus,1,'Keep editable controls focused');

  const requests=[],container={dataset:{},textContent:'',closest:()=>null,append(image){this.image=image;}};
  const previewContext=vm.createContext({view:{scale:.3},window:{canvasFiles:{loadProjectAsset:args=>new Promise(resolve=>requests.push({args,resolve}))}},document:{createElement:()=>({dataset:{}})},watchImagePanBounds(){}});
  vm.runInContext(fn('renderProjectAsset'),previewContext);
  const first=previewContext.renderProjectAsset(container,'a.png','test.json');
  previewContext.view.scale=1;
  const second=previewContext.renderProjectAsset(container,'a.png','test.json');
  requests[1].resolve({ok:true,url:'full',mimeType:'image/png'});await second;
  requests[0].resolve({ok:true,url:'small',originalUrl:'full',mimeType:'image/png'});await first;
  assert.equal(container.image.src,'full','Stale low-resolution request cannot replace full image');
  previewContext.view.scale=.3;
  const third=previewContext.renderProjectAsset(container,'a.png','test.json');
  previewContext.view.scale=1;
  requests[2].resolve({ok:true,url:'small',originalUrl:'full',mimeType:'image/png'});await settle();
  assert.equal(requests[3].args.preview,false,'Zoom reversal before timer must retry with current detail');
  requests[3].resolve({ok:true,url:'full-new',mimeType:'image/png'});await third;
  assert.equal(container.image.src,'full-new');

  let opened,loaded;
  const current=node('asset','asset',{assetPath:'new.png',projectPath:'new.json'});
  const quickContext=vm.createContext({getNode:()=>current,window:{canvasFiles:{loadProjectAsset:async args=>{loaded=args;return {ok:true,url:'small',originalUrl:'original'};}}},openImageViewer:url=>opened=url});
  vm.runInContext(fn('openQuickImage'),quickContext);await quickContext.openQuickImage('asset');
  assert.equal(loaded.assetPath,'new.png');assert.equal(opened,'original');
  console.log('PASS: audio storage/link save, mixed drop, audio WebM routing, shortcut modifiers, capture focus, preview races, current sidebar original URL');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
