const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app.js','utf8');
const code=source.slice(source.indexOf('      function deletionBlocker('),source.indexOf('      function beginNodeResize('));
function fixture(){
  const nodes=[],events={},history=[];
  function node(id,kind,x=0,y=0,title=id){
    const classes=new Set(['selected']);const label={textContent:title};
    const n={dataset:{id,kind,x,y,autoPosition:'true'},style:{},classList:{contains:k=>classes.has(k),add:k=>classes.add(k),remove:k=>classes.delete(k)},setPointerCapture(){},hasPointerCapture(){return true;},releasePointerCapture(){},querySelector:()=>label,remove(){nodes.splice(nodes.indexOf(n),1);}};nodes.push(n);return n;
  }
  const ctx={nodesLayer:{children:nodes,contains:n=>nodes.includes(n)},connections:[],getNode:id=>nodes.find(n=>n.dataset.id===id),quickNodeTitle:n=>n.querySelector().textContent,selectedCanvasNodes:()=>nodes.filter(n=>n.classList.contains('selected')),view:{scale:2},document:{addEventListener:(k,f)=>events[k]=f,removeEventListener:k=>delete events[k]},scheduleDragGeometry(){},renderConnections(){},beginManualCanvasLayout:()=>({}),finishManualCanvasLayout(){},recordCanvasLayoutChange(){ctx.layoutChanges=(ctx.layoutChanges||0)+1;},save:async()=>{ctx.saves=(ctx.saves||0)+1;},runCanvasAction:async(label,f)=>{history.push(label);await f();},beginCanvasAction:label=>(history.push(label),history.length),endCanvasAction(){},cancelCanvasAction:()=>history.pop(),shotLaneLayoutVersion:0,toast:msg=>ctx.message=msg,toastAction(){},undoLastCanvasChange(){},pruneUndoHistory:async()=>{}};
  vm.createContext(ctx);vm.runInContext(code,ctx);
  const pointer=(type,x,y)=>events[type]?.({type,pointerId:1,clientX:x,clientY:y,preventDefault(){}});
  return {ctx,nodes,node,history,pointer};
}
(async()=>{
  {
    const {ctx,node,history,pointer}=fixture();const a=node('a','text',10,20),b=node('b','text',80,90);
    ctx.beginNodeMove(a,{pointerId:1,clientX:100,clientY:100});pointer('pointermove',140,120);
    assert.deepEqual([+a.dataset.x,+a.dataset.y,+b.dataset.x,+b.dataset.y],[30,30,100,100],'selection translates by the same world-space delta');
    pointer('pointercancel',140,120);
    assert.deepEqual([+a.dataset.x,+a.dataset.y,+b.dataset.x,+b.dataset.y],[10,20,80,90],'cancel restores all member positions');assert.equal(history.length,0,'cancel creates no history');
  }
  {
    const {ctx,node,pointer,history}=fixture();const script=node('s','script',10,20),follower=node('p','plot',400,40),manual=node('m','style',900,60);manual.dataset.autoPosition='false';manual.classList.remove('selected');
    ctx.beginNodeMove(script,{pointerId:1,clientX:0,clientY:0});pointer('pointermove',20,40);pointer('pointerup',20,40);
    assert.deepEqual([+script.dataset.x,+follower.dataset.x,+manual.dataset.x],[20,410,900],'selected script follower moves once and unselected manual follower stays');assert.equal(history.length,1);
  }
  {
    const {ctx,node,history,nodes}=fixture();const parent=node('s','shot'),child=node('b','storyboard'),protectedNode=node('p','plot');ctx.connections=[{fromId:'s',toId:'b'}];
    await ctx.removeNodes([parent]);assert.equal(nodes.length,3,'unselected child blocks whole deletion');
    await ctx.removeNodes([child,protectedNode]);assert.equal(nodes.length,3,'protected member blocks entire batch');assert.equal(history.length,0);
    await ctx.removeNodes([parent,child]);assert.deepEqual(nodes.map(n=>n.dataset.id),['p'],'selected child allows parent deletion');assert.equal(ctx.connections.length,0);assert.equal(history.length,1,'batch deletion is one action');
  }
  {
    const {ctx,node}=fixture();const group=node('g','shot-group'),s1=node('s1','shot',0,0,'场景01 A'),s2=node('s2','shot',0,0,'场景02 B'),s3=node('s3','shot',0,0,'场景03 C'),s4=node('s4','shot',0,0,'场景04 D');
    const b1=node('b1','storyboard',0,0,'镜头01 A'),b2=node('b2','storyboard',0,0,'镜头02 B'),b3=node('b3','storyboard',0,0,'镜头03 C'),b4=node('b4','storyboard',0,0,'镜头04 D'),other=node('o','storyboard',0,0,'镜头04 Other');
    ctx.connections=[s1,s2,s3,s4].map(n=>({fromId:'g',toId:n.dataset.id})).concat([b1,b2,b3,b4].map(n=>({fromId:'s3',toId:n.dataset.id})),[{fromId:'s4',toId:'o'}]);
    ctx.renumberAfterNodesDeletion([s1,s2,b1,b2]);assert.equal(s3.querySelector().textContent,'场景01 C');assert.equal(s4.querySelector().textContent,'场景02 D');assert.equal(b3.querySelector().textContent,'镜头01 C');assert.equal(b4.querySelector().textContent,'镜头02 D');assert.equal(other.querySelector().textContent,'镜头04 Other','renumber stays within each parent');
  }
  assert(!source.slice(source.indexOf('      function beginNodeMove('),source.indexOf('      function beginConnectionDrag(')).includes('save('),'move and resize do not auto-save');
  console.log('Selection batch regression passed; move/resize do not auto-save');
})().catch(error=>{console.error(error);process.exitCode=1;});
