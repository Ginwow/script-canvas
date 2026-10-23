const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const e=require('electron');
e.app.disableHardwareAcceleration();
const folder=path.resolve(__dirname,'../recovery/image-copy-check');fs.mkdirSync(folder,{recursive:true});
e.app.setPath('userData',fs.mkdtempSync(path.join(folder,'user-')));
const store=require('../project-store.cjs');store.openLast=async()=>null;store.migrate=async()=>null;
const original=Module._load;
Module._load=function(name,parent,...args){if(name==='electron'&&parent?.filename===path.resolve(__dirname,'../main.cjs'))return {...e,BrowserWindow:class extends e.BrowserWindow{constructor(options){super({...options,show:false});}}};return original.call(this,name,parent,...args);};
const timer=setTimeout(()=>{console.error('Timeout');e.app.exit(1)},20000);
e.app.on('browser-window-created',(_event,win)=>win.webContents.once('did-finish-load',async()=>{
try{
const bytes=e.nativeImage.createFromBitmap(Buffer.alloc(16*16*4,255),{width:16,height:16}).toPNG();
const file=path.join(folder,'测试图片.png');fs.writeFileSync(file,bytes);
const result=await win.webContents.executeJavaScript(`window.canvasFiles.copyImage(${JSON.stringify(require('node:url').pathToFileURL(file).href)})`);
assert.equal(result.ok,true,result.error);
const items=await e.clipboard.read();const item=items.find(item=>item.types.includes('image/png'));assert.ok(item,'Clipboard must contain an image');
const blob=await item.getType('image/png');const image=e.nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));assert.deepEqual(image.getSize(),{width:16,height:16});
console.log('PASS: real local file -> IPC -> system image clipboard -> read back 16x16');clearTimeout(timer);e.app.exit(0);
}catch(error){console.error(error);clearTimeout(timer);e.app.exit(1)}
}));
require('../main.cjs');
