const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const electron=require('electron');
electron.app.disableHardwareAcceleration();
electron.app.disableHardwareAcceleration();
const folder=path.resolve(__dirname,'../recovery/storage-only-check');fs.mkdirSync(folder,{recursive:true});
electron.app.setPath('userData',fs.mkdtempSync(path.join(folder,'user-data-')));
const fixture={format:'white-canvas-video-project',version:3,project:{title:'Storage check'},synopsis:'Story',visualStyle:'Animation',characters:[],shots:[{id:'shot-1',title:'镜头01',description:'Rain'}],storyboards:[{id:'board-1',shotId:'shot-1',title:'分镜01',prompt:'Original'},{id:'board-2',shotId:'shot-1',title:'分镜02',prompt:'Second'}],canvas:{view:{x:0,y:0,scale:1},nodes:[],connections:[],shotLaneLayoutVersion:2}};
const fixturePath=path.join(folder,'fixture.json');fs.writeFileSync(fixturePath,JSON.stringify(fixture));
const store=require('../project-store.cjs');let saves=0;
store.openLast=async()=>({project:fixture,projectPath:fixturePath});store.migrate=async()=>({project:fixture,projectPath:fixturePath});
store.save=async(file,state)=>{assert.equal(file,fixturePath);const project=store.projectFromState(state,JSON.parse(fs.readFileSync(fixturePath)));fs.writeFileSync(fixturePath,JSON.stringify(project));saves++;return {project};};
const load=Module._load;
Module._load=function(name,parent,...args){if(name==='electron'&&parent?.filename===path.resolve(__dirname,'../main.cjs'))return {...electron,BrowserWindow:class extends electron.BrowserWindow{constructor(options){super({...options,show:false});}}};return load.call(this,name,parent,...args);};
const errors=[];
electron.app.on('web-contents-created',(_event,contents)=>contents.on('console-message',details=>{if(details.level==='error')errors.push(details.message);}));
const timeout=setTimeout(()=>{console.error('FAIL: timeout',errors);electron.app.exit(1);},25000);
electron.app.on('browser-window-created',(_event,window)=>{
 window.webContents.once('did-finish-load',async()=>{
  try {
   await new Promise(resolve=>setTimeout(resolve,900));
   const initial=await window.webContents.executeJavaScript(`({chat:!!document.querySelector('#chatPanel,#chatOpen,.node-context-toggle'),width:document.querySelector('#viewport').clientWidth,windowWidth:innerWidth,nodes:document.querySelectorAll('.node').length,boards:document.querySelectorAll('.node.storyboard').length,bridge:!!window.canvasFiles,oldBridge:!!window.canvasGPT})`);
   assert.equal(initial.chat,false);assert.equal(initial.width,initial.windowWidth);assert.equal(initial.boards,2);assert.equal(initial.bridge,true);assert.equal(initial.oldBridge,false);assert.ok(initial.nodes>2);
   const textInteractions=await window.webContents.executeJavaScript(`(()=>{const node=document.querySelector('.node.storyboard'),body=node.querySelector('.node-body');document.querySelectorAll('.node.selected').forEach(item=>item.classList.remove('selected'));node.classList.add('selected');const transfer=new DataTransfer();window.dispatchEvent(new ClipboardEvent('copy',{clipboardData:transfer,bubbles:true,cancelable:true}));const copied=transfer.getData('text/plain');const replacement=new DataTransfer();replacement.setData('text/plain','Replacement\\nSecond line');window.dispatchEvent(new ClipboardEvent('paste',{clipboardData:replacement,bubbles:true,cancelable:true}));const before=body.innerHTML;body.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));const stable=body.innerHTML===before&&body.classList.contains('prompt-reading')&&getComputedStyle(body).whiteSpace==='normal';body.dispatchEvent(new Event('blur'));return {copied,stable,title:!!body.querySelector('.prompt-section-title')};})()`);
   assert.equal(textInteractions.copied,'Original');assert.equal(textInteractions.stable,true);assert.equal(textInteractions.title,false);
   await new Promise(resolve=>setTimeout(resolve,250));assert.equal(JSON.parse(fs.readFileSync(fixturePath)).storyboards[0].prompt,'Replacement\nSecond line');console.log('PASS: selected node copy/paste replaces text; editing preserves reading format without redundant heading');
   await window.webContents.executeJavaScript(`(()=>{const body=document.querySelector('.node.storyboard .node-body');body.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,clientX:0,clientY:0}));body.innerText='Edited';body.dispatchEvent(new Event('input',{bubbles:true}));body.dispatchEvent(new Event('blur'));})()`);
   await new Promise(resolve=>setTimeout(resolve,250));
   const saved=JSON.parse(fs.readFileSync(fixturePath));assert.equal(saved.storyboards[0].prompt,'Edited');assert.equal(saved.storyboards[1].id,'board-2');assert.equal(saved.project.codex,undefined);assert.ok(saves>0);
   const png=electron.nativeImage.createFromBitmap(Buffer.alloc(16*16*4,255),{width:16,height:16}).toPNG().toString('base64');
   await window.webContents.executeJavaScript(`(()=>{document.querySelectorAll('.node.selected').forEach(node=>node.classList.remove('selected'));document.querySelector('.node.storyboard').classList.add('selected');const bytes=Uint8Array.from(atob('${png}'),c=>c.charCodeAt(0));const transfer=new DataTransfer();transfer.items.add(new File([bytes],'test.png',{type:'image/png'}));window.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));})()`);
   await new Promise(resolve=>setTimeout(resolve,500));
   const withImage=JSON.parse(fs.readFileSync(fixturePath));const asset=withImage.canvas.nodes.find(node=>node.kind==='asset');assert.ok(asset?.assetPath);assert.ok(withImage.canvas.connections.some(edge=>edge.fromId==='board-1'&&edge.toId===asset.id));assert.equal(withImage.storyboards[0].referenceImages.length,1);console.log('PASS: pasted image stored and connected to original storyboard');
   const drag=await window.webContents.executeJavaScript(`(()=>{const bytes=Uint8Array.from(atob('${png}'),c=>c.charCodeAt(0));const transfer=new DataTransfer();transfer.items.add(new File([bytes],'external.png',{type:'image/png'}));const board=document.querySelector('[data-id="board-2"]');board.dispatchEvent(new DragEvent('dragenter',{dataTransfer:transfer,bubbles:true,cancelable:true}));board.dispatchEvent(new DragEvent('dragover',{dataTransfer:transfer,bubbles:true,cancelable:true}));const highlighted=board.classList.contains('image-drop-target');board.dispatchEvent(new DragEvent('dragleave',{dataTransfer:transfer,bubbles:true}));const cleared=!board.classList.contains('image-drop-target');board.dispatchEvent(new DragEvent('dragover',{dataTransfer:transfer,bubbles:true,cancelable:true}));board.dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));return {highlighted,cleared,dropCleared:!board.classList.contains('image-drop-target')};})()`);
   assert.equal(drag.highlighted,true);assert.equal(drag.cleared,true);assert.equal(drag.dropCleared,true);
   await new Promise(resolve=>setTimeout(resolve,500));
   const dropped=JSON.parse(fs.readFileSync(fixturePath));assert.equal(dropped.storyboards.find(board=>board.id==='board-2').referenceImages.length,1);assert.equal(dropped.storyboards.find(board=>board.id==='board-1').referenceImages.length,1);const added=dropped.canvas.connections.find(edge=>edge.fromId==='board-2');assert.ok(added&&dropped.canvas.nodes.find(node=>node.id===added.toId&&node.kind==='asset'));console.log('PASS: external image drag highlights target, leaving clears it, drop binds to correct storyboard');
   assert.deepEqual(errors,[]);console.log('PASS: no conversation UI or bridge, full canvas width, v3 import without thread, node editing and saving');
   const before=saves;window.once('closed',()=>{try{assert.ok(saves>before);console.log('PASS: graceful close saved current state');clearTimeout(timeout);}catch(error){console.error(error);electron.app.exit(1);}});window.close();
  }catch(error){console.error(error,errors);clearTimeout(timeout);electron.app.exit(1);}
 });
});
require('../main.cjs');
