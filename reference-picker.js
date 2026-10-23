(function(){
 const fileUrl=file=>'file:///'+file.replace(/\\/g,'/').split('/').map((p,i)=>i?encodeURIComponent(p):p).join('/');
 function floatingWindow(className,html){
  const panel=document.createElement('section');panel.className='reference-floating '+className;panel.setAttribute('role','dialog');panel.innerHTML=html;
  document.body.append(panel);const header=panel.querySelector('header');
  panel.addEventListener('pointerdown',event=>{event.stopPropagation();panel.style.zIndex=String(++floatingWindow.layer);});
  for(const type of ['click','dblclick','contextmenu','wheel','keydown','keyup'])panel.addEventListener(type,event=>event.stopPropagation());
  header.addEventListener('pointerdown',event=>{
   if(event.button!==0||event.target.closest('button,select,input'))return;
   event.preventDefault();const bounds=panel.getBoundingClientRect(),x=event.clientX,y=event.clientY;
   panel.style.left=bounds.left+'px';panel.style.top=bounds.top+'px';panel.style.transform='none';header.setPointerCapture(event.pointerId);
   const drag=e=>{panel.style.left=Math.max(0,Math.min(window.innerWidth-80,bounds.left+e.clientX-x))+'px';panel.style.top=Math.max(0,Math.min(window.innerHeight-40,bounds.top+e.clientY-y))+'px';};
   const end=()=>{header.removeEventListener('pointermove',drag);header.removeEventListener('pointerup',end);header.removeEventListener('pointercancel',end);};
   header.addEventListener('pointermove',drag);header.addEventListener('pointerup',end);header.addEventListener('pointercancel',end);
  });
  panel.style.zIndex=String(++floatingWindow.layer);return panel;
 }
 floatingWindow.layer=1000;
 window.refreshCanvasReferenceLibrary=async()=>{const result=await window.canvasFiles.listReferences();if(!result.ok)throw new Error(result.error);};
 window.showCanvasReferencePicker=async function(importSelected){
  window.closeCanvasReferencePicker?.();
  const bridge=window.canvasFiles,panel=floatingWindow('reference-library','<header><strong>参考素材库</strong><select aria-label="素材分类"></select><button data-add>存入素材库</button><button data-close>关闭</button></header><div class="reference-library-grid"></div><p data-status role="status" hidden></p>');
  const category=panel.querySelector('header select'),grid=panel.querySelector('.reference-library-grid'),status=panel.querySelector('[data-status]');
  const add=panel.querySelector('[data-add]');
  let items=[],selected=new Set(),busy=false,preview=null;
  const close=()=>{preview?.remove();panel.querySelectorAll('audio').forEach(a=>a.pause());panel.remove();if(window.closeCanvasReferencePicker===close)window.closeCanvasReferencePicker=null;};window.closeCanvasReferencePicker=close;
  const controls=()=>{add.disabled=busy||!category.value;};
  const action=async task=>{if(busy)return;busy=true;controls();try{status.hidden=true;await task();}catch(error){status.hidden=false;status.textContent=error.message;}finally{busy=false;controls();}};
  const showPreview=item=>window.openCanvasImageViewer(fileUrl(item.path));
  const render=()=>{grid.querySelectorAll('audio').forEach(audio=>audio.pause());grid.replaceChildren();if(!category.value){grid.textContent='请选择分类';controls();return;}const visible=items.filter(i=>i.category===category.value);if(!visible.length)grid.textContent='暂无素材，点击“存入素材库”添加。';
   for(const item of visible){const card=document.createElement('div');card.className='reference-material-card';card.tabIndex=0;card.draggable=true;card.setAttribute('role','button');card.setAttribute('aria-label',item.type==='audio'?'选择参考音色':'选择并预览参考图');card.setAttribute('aria-pressed',String(selected.has(item.path)));
    const toggle=()=>{selected.clear();selected.add(item.path);grid.querySelectorAll('.reference-material-card').forEach(other=>other.setAttribute('aria-pressed',String(other===card)));controls();};
    card.onclick=event=>{if(!event.target.closest('audio'))toggle();};card.ondblclick=event=>{if(!event.target.closest('audio')&&item.type!=='audio')showPreview(item);};
    card.onkeydown=event=>{if(event.target===card&&(event.key==='Enter'||event.key===' ')){event.preventDefault();toggle();}};
    card.ondragstart=event=>{window.canvasDraggingReference=item;event.stopPropagation();event.dataTransfer.effectAllowed='copy';event.dataTransfer.setData('application/x-canvas-reference',JSON.stringify(item));};
    card.ondragend=()=>{window.canvasDraggingReference=null;const hint=document.querySelector('#fileDropHint');if(hint)hint.hidden=true;};
    const media=document.createElement(item.type==='audio'?'audio':'img');media.src=fileUrl(item.path);if(item.type==='audio'){media.controls=true;media.preload='none';}else{media.loading='lazy';media.alt='参考素材预览';media.draggable=false;}card.append(media);if(item.type==='audio'){const name=document.createElement('div');name.className='reference-audio-name';name.textContent=item.name;card.append(name);}grid.append(card);
   }controls();};
  const refresh=async()=>{const r=await bridge.listReferences();if(!r.ok)throw new Error(r.error);if(!panel.isConnected)return;items=r.items;const value=category.value;category.replaceChildren();const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='请选择分类';category.append(placeholder);for(const c of r.categories){const o=document.createElement('option');o.value=o.textContent=c;category.append(o);}category.value=r.categories.includes(value)?value:'';selected=new Set([...selected].filter(p=>items.some(i=>i.path===p)));render();};
  window.refreshCanvasReferenceLibrary=()=>action(refresh);
  category.onchange=()=>{selected.clear();render();};panel.querySelector('[data-close]').onclick=close;
  add.onclick=()=>action(async()=>{const r=await bridge.importReferences(category.value);if(!r.ok)throw new Error(r.error);await refresh();if(r.errors?.length)throw new Error(r.errors.join('；'));});
  try{await refresh();}catch(error){grid.textContent=error.message;controls();}
 };
 window.showReferenceCategoryPicker=async function(callback){
  document.querySelector('.reference-category-picker')?.remove();
  const panel=floatingWindow('reference-category-picker','<header><strong>存入素材库</strong><button data-close>关闭</button></header><div class="reference-category-options"></div><p role="status"></p>');
  panel.querySelector('[data-close]').onclick=()=>panel.remove();
  try{const result=await window.canvasFiles.listReferences();if(!result.ok)throw new Error(result.error);if(!panel.isConnected)return;
   for(const category of result.categories.filter(value=>!['参考音色','BGM'].includes(value))){const button=document.createElement('button');button.textContent=category;button.onclick=async()=>{const buttons=panel.querySelectorAll('.reference-category-options button');buttons.forEach(b=>b.disabled=true);try{await callback(category);panel.remove();}catch(error){panel.querySelector('p').textContent=error.message;buttons.forEach(b=>b.disabled=false);}};panel.querySelector('.reference-category-options').append(button);}
  }catch(error){panel.querySelector('p').textContent=error.message;}
 };
})();
