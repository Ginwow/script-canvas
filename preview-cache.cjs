const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
const {pathToFileURL} = require('node:url');

// Decode in the existing renderer. No BrowserWindow, utility process or worker is created.
function decodePreview(webContents, realAsset, timeoutMs = 15000) {
  if (!webContents || webContents.isDestroyed()) return Promise.reject(Error('预览窗口已关闭'));
  const url = pathToFileURL(realAsset).href;
  const script = `(async()=>{
    const image=new Image(); let bitmap, timer, ended=false;
    try {
      image.src=${JSON.stringify(url)};
      return await Promise.race([(async()=>{
        await image.decode();
        const scale=Math.min(1,640/Math.max(image.naturalWidth,image.naturalHeight));
        const width=Math.max(1,Math.round(image.naturalWidth*scale));
        const height=Math.max(1,Math.round(image.naturalHeight*scale));
        bitmap=await createImageBitmap(image,{resizeWidth:width,resizeHeight:height,resizeQuality:'medium'});
        if(ended){bitmap.close();throw Error('预览已取消');}
        const canvas=new OffscreenCanvas(width,height);
        canvas.getContext('2d').drawImage(bitmap,0,0);
        const blob=await canvas.convertToBlob({type:'image/png'});
        if(blob.size>4*1024*1024)throw Error('预览图片过大');
        return new Uint8Array(await blob.arrayBuffer());
      })(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('预览超时')),${timeoutMs});})]);
    } finally {ended=true;clearTimeout(timer);image.src='';if(bitmap)bitmap.close();}
  })()`;
  return new Promise((resolve,reject) => {
    let finished=false;
    const done=(error,value)=>{
      if(finished)return;finished=true;
      clearTimeout(timer);
      webContents.removeListener('destroyed',closed);
      webContents.removeListener('render-process-gone',closed);
      webContents.removeListener('did-start-navigation',navigated);
      if(error)reject(error);else resolve(value);
    };
    const closed=()=>done(Error('预览窗口已关闭'));
    const navigated=(_event,_url,_inPlace,isMainFrame)=>{if(isMainFrame)closed();};
    const timer=setTimeout(()=>done(Error('预览超时')),timeoutMs+1000);
    webContents.once('destroyed',closed);
    webContents.once('render-process-gone',closed);
    webContents.on('did-start-navigation',navigated);
    Promise.resolve().then(()=>webContents.executeJavaScript(script)).then(value=>{
      const bytes=Buffer.from(value);
      const signature=Buffer.from([137,80,78,71,13,10,26,10]);
      if(bytes.length<24 || bytes.length>4*1024*1024 || !bytes.subarray(0,8).equals(signature))throw Error('预览数据无效');
      if(!bytes.readUInt32BE(16) || !bytes.readUInt32BE(20) || bytes.readUInt32BE(16)>640 || bytes.readUInt32BE(20)>640)throw Error('预览尺寸无效');
      done(null,bytes);
    }).catch(done);
  });
}

function createPreviewCache({directory,decode,concurrency=2}) {
  const jobs=new Map(),queue=[];
  let active=0,writes=0,cleanup=Promise.resolve();
  function drain(){
    while(active<concurrency && queue.length){
      const {run,resolve,reject}=queue.shift();active++;
      Promise.resolve().then(run).then(resolve,reject).finally(()=>{active--;drain();});
    }
  }
  function schedule(run){return new Promise((resolve,reject)=>{queue.push({run,resolve,reject});drain();});}
  async function prune(){
    const entries=await fs.readdir(directory,{withFileTypes:true});
    const files=await Promise.all(entries.filter(entry=>entry.isFile() && /^[a-f0-9]{64}\.png$/.test(entry.name)).map(async entry=>{
      const file=path.join(directory,entry.name),stat=await fs.stat(file);return {file,size:stat.size,time:stat.mtimeMs};
    }));
    files.sort((a,b)=>b.time-a.time);let bytes=0;
    for(let i=0;i<files.length;i++){bytes+=files[i].size;if(i>=256 || bytes>256*1024*1024)await fs.unlink(files[i].file).catch(()=>{});}
  }
  async function preview(realAsset,info){
    const key=createHash('sha256').update(JSON.stringify([realAsset,info.size,info.mtimeMs,info.ctimeMs,'renderer-png-640-v2'])).digest('hex');
    if(jobs.has(key))return jobs.get(key);
    const job=(async()=>{
      const destination=path.join(directory,key+'.png');
      try{if((await fs.stat(destination)).isFile())return destination;}catch(error){if(error.code!=='ENOENT')throw error;}
      return schedule(async()=>{
        const bytes=await decode(realAsset);
        await fs.mkdir(directory,{recursive:true});
        const temporary=destination+'.'+randomUUID()+'.writing';
        try{await fs.writeFile(temporary,bytes,{flag:'wx'});await fs.rename(temporary,destination);}
        finally{await fs.unlink(temporary).catch(()=>{});}
        if(writes++%32===0)cleanup=cleanup.then(prune).catch(()=>{});
        return destination;
      });
    })();
    jobs.set(key,job);
    try{return await job;}finally{jobs.delete(key);}
  }
  return {preview,settled:()=>cleanup};
}

module.exports={createPreviewCache,decodePreview};
