// Exercise the actual native close IPC handlers without opening Electron windows.
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'..','main.cjs'),'utf8');
const handlers=new Map(),timers=new Map(),errors=[];
let timerId=0,dialogCalls=0,closeCalls=0,currentDialog=null;
const window={webContents:{},isDestroyed:()=>false,close:()=>closeCalls++};
const context=vm.createContext({
 Promise,setImmediate:fn=>fn(),
 setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),
 ipcMain:{handle:(name,handler)=>handlers.set(name,handler)},
 dialog:{
  showMessageBox:(win,options)=>{
   assert.equal(win,window);
   assert.equal(options.message,'画布内容已经变化，是否保存？');
   assert.match(options.detail,/自动保存/);
   assert.deepEqual(Array.from(options.buttons),['保存','不保存','取消']);
   assert.equal(options.defaultId,0);assert.equal(options.cancelId,2);
   dialogCalls++;
   return new Promise((resolve,reject)=>{currentDialog={resolve,reject};});
  },
  showErrorBox:(...args)=>errors.push(args)
 },
 undoProjects:[],undoAssets:{prune:async()=>{}},APP_TITLE:'剧本画布',APP_URL:'file:///app',window
});
function section(start,end){
 const a=source.indexOf(start),b=source.indexOf(end,a);
 assert.ok(a>=0&&b>a,`Missing handler boundary: ${start}`);
 return source.slice(a,b);
}
vm.runInContext(
 section('let mainWindow=','function writeCanvasRuntimeState')+
 section('function assertMainWindow','function pathIsWithin')+
 section("  ipcMain.handle('canvas:confirm-close-changes'","  handleProjectOperation('canvas-project:open-last'")+
 'mainWindow=window;',context
);
const event={sender:window.webContents,senderFrame:{url:'file:///app'}};
const prompt=handlers.get('canvas:confirm-close-changes'),finish=handlers.get('canvas:finish-close');
const state=expression=>vm.runInContext(expression,context);
function beginClose(){state('canvasClosePending=true;startCanvasCloseTimer();');assert.equal(timers.size,1);}
async function showPrompt(){const result=prompt(event);assert.equal(timers.size,0);await Promise.resolve();await Promise.resolve();return {result};}
async function check(){
 await assert.rejects(prompt({sender:{},senderFrame:{url:'file:///app'}}),/未授权/);
 await assert.rejects(finish({sender:{},senderFrame:{url:'file:///app'}},{ok:true}),/未授权/);
 assert.equal((await prompt(event)).action,'cancel');assert.equal(dialogCalls,0);
 for(const [response,expected] of [[0,'save'],[1,'discard'],[2,'cancel']]){
  beginClose();const {result}=await showPrompt(),duplicate=prompt(event);
  assert.equal(timers.size,0);currentDialog.resolve({response});
  assert.equal((await result).action,expected);assert.equal((await duplicate).action,expected);
  assert.equal(timers.size,1);
  assert.equal((await finish(event,{cancelled:true})).cancelled,true);
  assert.equal(timers.size,0);assert.equal(state('canvasClosePending'),false);
  assert.equal(state('canvasCloseApproved'),false);
 }
 assert.equal(dialogCalls,3);assert.equal(errors.length,0);assert.equal(closeCalls,0);

 // Cancelling while a native dialog remains unresolved must not reopen the timer.
 beginClose();const {result:cancelledPrompt}=await showPrompt();
 await finish(event,{cancelled:true});currentDialog.resolve({response:2});
 assert.equal((await cancelledPrompt).action,'cancel');assert.equal(timers.size,0);
 assert.equal(state('canvasCloseApproved'),false);assert.equal(errors.length,0);

 // A failed native dialog restores the timeout, then cancellation can reset it.
 beginClose();const {result:failedPrompt}=await showPrompt();
 currentDialog.reject(new Error('native dialog unavailable'));
 await assert.rejects(failedPrompt,/native dialog unavailable/);
 assert.equal(timers.size,1);assert.equal(state('canvasCloseDialogPromise'),null);
 await finish(event,{cancelled:true});assert.equal(timers.size,0);

 // The resumed timeout retains the window, clears pending, and permits retry.
 beginClose();const {result:timedPrompt}=await showPrompt();
 currentDialog.resolve({response:0});await timedPrompt;
 assert.equal(timers.size,1);const [id,callback]=timers.entries().next().value;timers.delete(id);callback();
 assert.equal(state('canvasClosePending'),false);assert.equal(state('canvasCloseApproved'),false);
 assert.equal(errors.length,1);assert.equal(closeCalls,0);
 assert.equal((await finish(event,{ok:true})).ok,false);
 beginClose();assert.equal((await finish(event,{ok:true})).ok,true);
 assert.equal(closeCalls,1);assert.equal(timers.size,0);
 console.log('Native close IPC checks passed: authorization, choices, coalescing, pause/resume, pending cancellation, dialog rejection, timeout retry, approved close.');
}
check().catch(error=>{console.error(error);process.exitCode=1;});
