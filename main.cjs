const { app, BrowserWindow, Menu, ipcMain, dialog, nativeImage, clipboard, ClipboardItem, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { createStoragePolicy } = require('./storage-policy.cjs');
const projectStore = require('./project-store.cjs');
const { LEGACY_PROJECT_ROOT, PROJECT_ROOT, REFERENCE_ROOT } = require('./data-paths.cjs');
const { storeVideo } = require('./video-storage.cjs');
const {storeAudio,isAudioAssetPath} = require('./audio-storage.cjs');
const referenceLibrary = require('./reference-library.cjs');
const undoAssets=require('./undo-assets.cjs');
const assetTransactions=require('./asset-transaction.cjs');
const undoProjects=new Set();
const { prepareImageAsync, imageFingerprint, rememberImageFingerprint } = require('./png-storage.cjs');
const APP_TITLE = '剧本画布';
const INDEX_PATH = path.join(__dirname, 'index.html');
const APP_URL = pathToFileURL(INDEX_PATH).href;
let mainWindow=null,storagePolicy=null;
let projectWriteQueue=Promise.resolve();
let projectQuitFlushed=false,canvasCloseApproved=false,canvasClosePending=false,canvasCloseTimer=null;
let canvasCloseDialogPromise=null;
function clearCanvasCloseTimer() {
 clearTimeout(canvasCloseTimer);canvasCloseTimer=null;
}
function startCanvasCloseTimer() {
 clearCanvasCloseTimer();
 canvasCloseTimer=setTimeout(()=>{
  canvasCloseTimer=null;
  if(!canvasClosePending)return;
  canvasClosePending=false;
  dialog.showErrorBox('无法关闭画布','关闭前保存尚未完成。窗口已保留，请稍后重试。');
 },30000);
}
function writeCanvasRuntimeState(closed=false) {
 if(!app.isReady())return;
 try{require('node:fs').writeFileSync(path.join(app.getPath('userData'),'canvas-runtime-state.json'),JSON.stringify({pid:process.pid,updatedAt:Date.now(),busy:false,closed}));}catch{}
}
function assertMainWindow(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame?.url !== APP_URL) {
    throw new Error('未授权的本地请求。');
  }
}

function pathIsWithin(rootPath, candidatePath) {
  if (typeof rootPath !== 'string' || typeof candidatePath !== 'string' || !rootPath || !candidatePath) return false;
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function projectAssetMimeType(filePath) {
  const types = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.aac':'audio/aac', '.flac':'audio/flac'
  };
  return types[path.extname(filePath).toLowerCase()] || '';
}

const {createPreviewCache,decodePreview} = require('./preview-cache.cjs');
let imagePreviewCache;
function cachedImagePreview(realAsset, info) {
  imagePreviewCache ||= createPreviewCache({
    directory:path.join(app.getPath('userData'),'canvas-thumbnails'),
    decode:asset=>decodePreview(mainWindow?.webContents,asset)
  });
  return imagePreviewCache.preview(realAsset,info);
}

async function storeProjectImage(source, projectPath, suppliedBytes = null) {
  if(typeof source!=='string'||typeof projectPath!=='string'||!path.isAbsolute(projectPath))throw new Error('项目或图片路径无效');
  if(/^file:/i.test(source))source=fileURLToPath(source);
  if(!path.isAbsolute(source)||!/\.(png|jpe?g|webp|gif)$/i.test(source))throw new Error('图片路径或格式无效');
  const project=await fs.realpath(projectPath);if(!(await fs.stat(project)).isFile())throw new Error('项目文件不存在');
  const info=suppliedBytes?{size:suppliedBytes.length,isFile:()=>true}:await fs.stat(source);if(!info.isFile()||info.size>100*1024*1024)throw new Error('图片不存在或过大');
  const base=path.dirname(project),realSource=suppliedBytes?source:await fs.realpath(source);
  const prepared=await prepareImageAsync(suppliedBytes || await fs.readFile(source), !suppliedBytes);
  const bytes=prepared.bytes,name=prepared.hash+path.extname(source).toLowerCase();
  async function findExisting(directory) {
    let entries;try{entries=await fs.readdir(directory,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return null;throw error;}
    for(const entry of entries){if(entry.isSymbolicLink() || entry.name === '.undo')continue;const file=path.join(directory,entry.name);
      if(entry.isDirectory()){const match=await findExisting(file);if(match)return match;}
      else if(entry.isFile()&&path.extname(file).toLowerCase()===path.extname(source).toLowerCase()&&file!==realSource){
        const stat=await fs.stat(file);if(stat.size>100*1024*1024)continue;
        if(await imageFingerprint(file)===prepared.hash)return file;
      }
    }return null;
  }
  const existing=await findExisting(path.join(base,'assets'));
  if(existing)return {assetPath:path.relative(base,existing).split(path.sep).join('/'),path:existing};
  if(!suppliedBytes && pathIsWithin(base,realSource)){
    if(bytes.length<info.size){const temporary=realSource+'.'+randomUUID()+'.writing';await fs.writeFile(temporary,bytes,{flag:'wx'});await fs.rename(temporary,realSource);}
    return {assetPath:path.relative(base,realSource).split(path.sep).join('/'),path:realSource};
  }
  const directory=path.join(base,'assets','generated');await fs.mkdir(directory,{recursive:true});
  if(!pathIsWithin(base,await fs.realpath(directory)))throw new Error('素材目录超出项目');
  const destination=path.join(directory,name);
  try{await fs.writeFile(destination,bytes,{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
  await rememberImageFingerprint(destination,prepared.hash);
  return {assetPath:'assets/generated/'+name,path:destination};
}

function handleProjectOperation(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    assertMainWindow(event);
    const operation=projectWriteQueue.then(()=>handler(event,...args));
    projectWriteQueue=operation.catch(()=>{});
    return operation;
  });
}

function installIpcHandlers() {
  ipcMain.handle('canvas-project:open-folder', async (event, projectPath) => {
    assertMainWindow(event);
    try {
      const directory = projectStore.ROOT;
      await fs.mkdir(directory,{recursive:true});
      const error = await shell.openPath(directory);
      if (error) throw Error(error);
      return {ok:true};
    } catch(error) { return {ok:false,error:error.message}; }
  });
  ipcMain.handle('canvas:confirm-close-changes',async event=>{
    assertMainWindow(event);
    if(!canvasClosePending)return {action:'cancel'};
    if(canvasCloseDialogPromise)return canvasCloseDialogPromise;
    clearCanvasCloseTimer();
    const closingWindow=mainWindow;
    canvasCloseDialogPromise=(async()=>{
      try {
        const result=await Promise.resolve().then(()=>dialog.showMessageBox(closingWindow,{
          type:'question',title:APP_TITLE,message:'画布内容已经变化，是否保存？',
          detail:'自动保存的内容会保留。“不保存”仅跳过关闭时的保存。',
          buttons:['保存','不保存','取消'],defaultId:0,cancelId:2,noLink:true
        }));
        return {action:['save','discard','cancel'][result.response] || 'cancel'};
      } finally {
        canvasCloseDialogPromise=null;
        if(canvasClosePending&&mainWindow===closingWindow&&!closingWindow.isDestroyed())startCanvasCloseTimer();
      }
    })();
    return canvasCloseDialogPromise;
  });
  ipcMain.handle('canvas:finish-close',async(event,payload)=>{
    assertMainWindow(event);
    if(!canvasClosePending)return {ok:false};
    clearCanvasCloseTimer();canvasClosePending=false;
    if(payload?.cancelled)return {ok:true,cancelled:true};
    if(!payload?.ok){dialog.showErrorBox('无法关闭画布','保存当前状态失败：'+String(payload?.error||'未知错误'));return {ok:false};}
    await projectWriteQueue;
    try { for(const project of undoProjects)await undoAssets.prune(project); }
    catch(error){dialog.showErrorBox('无法关闭画布','清理撤销素材失败：'+String(error?.message||error));return {ok:false,error:String(error?.message||error)};}
    canvasCloseApproved=true;
    setImmediate(()=>mainWindow?.close());
    return {ok:true};
  });

  handleProjectOperation('canvas-project:open-last',async event=>{assertMainWindow(event);try{return {ok:true,...await projectStore.openLast()};}catch(error){return {ok:false,error:error.message};}});
  ipcMain.handle('canvas-project:library', async event => { assertMainWindow(event); try {return {ok:true,items:await projectStore.list(),root:projectStore.ROOT};}catch(error){return {ok:false,error:error.message};} });
  handleProjectOperation('canvas-project:manage', async (event,payload) => {assertMainWindow(event);try{return {ok:true,...await projectStore.migrate(typeof payload==='string'?payload:payload.path,payload?.state)};}catch(error){return {ok:false,error:error.message};} });
  handleProjectOperation('canvas-project:open-managed', async (event,source) => {assertMainWindow(event);try{return {ok:true,...await projectStore.open(source)};}catch(error){return {ok:false,error:error.message};} });
  ipcMain.handle('canvas-project:save-managed', async (event,payload) => {
    assertMainWindow(event);
    undoProjects.add(payload.path);
    const operation = projectWriteQueue.then(()=>projectStore.save(payload.path,payload.state,payload.historyAssets));
    projectWriteQueue=operation.catch(()=>{});
    try{return {ok:true,...await operation};}catch(error){return {ok:false,error:error.message};}
  });
  ipcMain.handle('canvas-project:prune-undo-assets',async(event,payload)=>{
    assertMainWindow(event);
    const operation=projectWriteQueue.then(async()=>{
      const keep=new Map();
      for(const item of payload?.projects || []){const project=await fs.realpath(item.path);if(!pathIsWithin(projectStore.ROOT,project))throw new Error('项目路径无效');keep.set(project,item.paths || []);undoProjects.add(project);}
      for(const project of undoProjects)await undoAssets.prune(project,keep.get(project) || []);
      return {ok:true};
    });projectWriteQueue=operation.catch(()=>{});try{return await operation;}catch(error){return {ok:false,error:error.message};}
  });
  ipcMain.handle('canvas-project:pin-undo-assets',async(event,payload)=>{
    assertMainWindow(event);
    const operation=projectWriteQueue.then(async()=>{
      const project=await fs.realpath(payload.projectPath);if(!pathIsWithin(projectStore.ROOT,project))throw new Error('项目路径无效');
      undoProjects.add(project);
      const base=path.dirname(project),directory=path.join(base,'assets','.undo');await fs.mkdir(directory,{recursive:true});const assets=[];
      for(const node of payload.nodes || []){
        if(!node.assetPath)continue;
        const source=await fs.realpath(path.resolve(base,node.assetPath));if(!pathIsWithin(base,source))throw new Error('素材路径无效');
        const bytes=await fs.readFile(source),name=createHash('sha256').update(bytes).digest('hex')+path.extname(source).toLowerCase();
        const relative='assets/.undo/'+(isAudioAssetPath(node.assetPath)?'audio/':'')+name;
        const destination=path.join(base,relative);await fs.mkdir(path.dirname(destination),{recursive:true});
        try{await fs.writeFile(destination,bytes,{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
        assets.push({id:node.id,assetPath:relative});
      }
      return {ok:true,assets};
    });projectWriteQueue=operation.catch(()=>{});
    try{return await operation;}catch(error){return {ok:false,error:error.message};}
  });
  ipcMain.handle('canvas-reference:list', async event => {
    assertMainWindow(event);
    try {return {ok:true,items:await referenceLibrary.list(),categories:referenceLibrary.categories};}
    catch(error){return {ok:false,error:error.message};}
  });
  ipcMain.handle('canvas-reference:save', async (event,source) => {
    assertMainWindow(event);
    try{
      let file=typeof source==='string'?source:source?.path;
      if(source?.assetPath){const project=await fs.realpath(source.projectPath);const base=path.dirname(project);file=await fs.realpath(path.resolve(base,source.assetPath));if(!pathIsWithin(projectStore.ROOT,project)||!pathIsWithin(base,file))throw new Error('素材路径无效');}
      return {ok:true,item:await referenceLibrary.save(file,source?.category)};
    }
    catch(error){return {ok:false,error:error.message};}
  });
  ipcMain.handle('canvas-reference:import', async (event,category) => {
    assertMainWindow(event);
    const audio=['参考音色','BGM'].includes(category);
    const picked=await dialog.showOpenDialog(mainWindow,{title:audio?(category==='BGM'?'导入BGM':'导入参考音色'):'导入参考素材',properties:['openFile','multiSelections'],filters:[audio?{name:'音频',extensions:['wav','mp3','m4a','aac','ogg','flac']}:{name:'图片',extensions:['png','jpg','jpeg','webp','gif']}]});
    const items=[],errors=[];
    for(const source of (picked.filePaths || []).slice(0,50))try{items.push(await referenceLibrary.save(source,category));}catch(error){errors.push(path.basename(source)+'：'+error.message);}
    return {ok:true,items,errors};
  });
  ipcMain.handle('canvas-reference:categorize', async (event,payload) => {
    assertMainWindow(event);
    try{return {ok:true,items:await referenceLibrary.categorize(payload?.paths,payload?.category)};}catch(error){return {ok:false,error:error.message};}
  });
  handleProjectOperation('canvas-reference:attach', async (event,payload) => {
    assertMainWindow(event);
    try {
      const source=await referenceLibrary.resolve(payload?.path);
      const projectPath=await fs.realpath(payload?.projectPath);
      if(!pathIsWithin(projectStore.ROOT,projectPath)||path.extname(projectPath).toLowerCase()!=='.json')throw new Error('请先打开一个本地项目');
      if(referenceLibrary.imagePattern.test(source))return {ok:true,...await storeProjectImage(source,projectPath),projectPath,type:'image',name:payload?.name || path.basename(source)};
      const assetPath=await storeAudio(path.dirname(projectPath),await fs.readFile(source),path.extname(source));
      return {ok:true,assetPath,projectPath,type:'audio',name:payload?.name || path.basename(source)};
    }catch(error){return {ok:false,error:error.message};}
  });

  ipcMain.handle('canvas-image:load', async (event,payload) => {
    assertMainWindow(event);
    try {
      let filePath = typeof payload?.path === 'string' ? payload.path : '';
      if (/^file:/i.test(filePath)) filePath=fileURLToPath(filePath);
      if (/^\/[a-z]:[\/]/i.test(filePath)) filePath=filePath.slice(1);
      if (!path.isAbsolute(filePath)) {
        if (typeof payload?.projectPath !== 'string' || !path.isAbsolute(payload.projectPath)) throw new Error('图片路径不是绝对路径');
        const base=path.dirname(payload.projectPath); filePath=path.resolve(base,filePath);
        if (!pathIsWithin(base,filePath)) throw new Error('图片路径超出项目目录');
      }
      if (!/\.(png|jpe?g|webp|gif)$/i.test(filePath)) throw new Error('不支持的图片格式');
      const info=await fs.stat(filePath);
      if (!info.isFile() || info.size > 100*1024*1024) throw new Error('图片不存在或过大');
      return { ok:true,url:pathToFileURL(filePath).href,path:filePath,name:path.basename(filePath) };
    } catch(error) { return { ok:false,error:error.message }; }
  });
  handleProjectOperation('canvas-image:import', async (event,payload) => {
    assertMainWindow(event);
    try {
      if (payload?.bytes instanceof Uint8Array) {
        if (!payload.bytes.length || payload.bytes.length > 20*1024*1024) throw Error('粘贴图片需小于20 MB');
        const bytes=Buffer.from(payload.bytes);
        if(nativeImage.createFromBuffer(bytes).isEmpty())throw Error('剪贴板图片无法读取');
        const extension=path.extname(payload.name || '').toLowerCase();
        if(!['.png','.jpg','.jpeg','.webp','.gif'].includes(extension))throw Error('图片格式无效');
        return {ok:true,...await storeProjectImage(path.join(app.getPath('userData'),'clipboard'+extension),payload.projectPath,bytes)};
      }
      return {ok:true,...await storeProjectImage(payload?.path,payload?.projectPath)};
    }
    catch(error){return {ok:false,error:error.message};}
  });

  ipcMain.handle('canvas-project:load-asset', async (event, payload) => {
    assertMainWindow(event);
    const projectPath = typeof payload?.projectPath === 'string' ? path.resolve(payload.projectPath) : '';
    const relativeAssetPath = typeof payload?.assetPath === 'string' ? payload.assetPath : '';
    if (!projectPath || path.extname(projectPath).toLowerCase() !== '.json' || !relativeAssetPath || path.isAbsolute(relativeAssetPath) || relativeAssetPath.split(/[\\/]/).includes('..')) {
      return { ok: false, error: '素材路径无效；只允许引用项目 JSON 同目录中的相对路径。' };
    }
    
    const pendingWrites=projectWriteQueue;
    const load=async()=>{
    try {
      const projectInfo = await fs.stat(projectPath);
      if (!projectInfo.isFile() || projectInfo.size > 5 * 1024 * 1024) return { ok: false, error: '项目 JSON 文件无效。' };
      const base = path.dirname(projectPath);
      const candidate = path.resolve(base, relativeAssetPath);
      const relative = path.relative(base, candidate);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return { ok: false, error: '素材路径必须位于项目 JSON 同目录或其子目录中。' };
      const [realBase, realAsset] = await Promise.all([fs.realpath(base), fs.realpath(candidate)]);
      const realRelative = path.relative(realBase, realAsset);
      if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) return { ok: false, error: '素材路径不能指向项目目录之外。' };
      const mimeType = path.extname(realAsset).toLowerCase()==='.webm' && isAudioAssetPath(realRelative) ? 'audio/webm' : projectAssetMimeType(realAsset);
      if (!mimeType) return { ok: false, error: '项目素材仅支持常见图片、视频和音频格式。' };
      const info = await fs.stat(realAsset);
      if (!info.isFile() || info.size > 100 * 1024 * 1024) return { ok: false, error: '素材必须是 100 MB 以内的文件。' };
      const previewUrl=pathToFileURL(realAsset);
      if(mimeType.startsWith('image/'))previewUrl.searchParams.set('v',[info.size,info.mtimeMs,info.ctimeMs].join('-'));
      if(payload?.preview === true && mimeType.startsWith('image/')) {
        try {
          const thumbnail = await cachedImagePreview(realAsset, info);
          return {ok:true, mimeType:'image/png', url:pathToFileURL(thumbnail).href, originalUrl:previewUrl.href};
        } catch (_) { return {ok:true, mimeType, url:previewUrl.href, originalUrl:previewUrl.href}; }
      }
      return { ok: true, mimeType, url: previewUrl.href };
    } catch (error) {
      return { ok: false, error: '找不到项目中引用的素材文件。', retryable:error.code==='ENOENT' };
    }
    };
    let result=await assetTransactions.withStableRead(path.dirname(projectPath),load);
    if(result.retryable){await pendingWrites.catch(()=>{});result=await assetTransactions.withStableRead(path.dirname(projectPath),load);}
    delete result.retryable;return result;
  });

  ipcMain.handle('canvas-project:read-json', async (event, projectPath) => {
    assertMainWindow(event);
    if (typeof projectPath !== 'string' || projectPath.length > 4096 || !path.isAbsolute(projectPath) || path.extname(projectPath).toLowerCase() !== '.json') {
      return { ok: false, error: '项目 JSON 路径无效，请重新打开项目。' };
    }
    try {
      return await assetTransactions.withStableRead(path.dirname(projectPath),async()=>{
      const filePath = path.resolve(projectPath);
      const info = await fs.stat(filePath);
      if (!info.isFile() || info.size > 5 * 1024 * 1024) {
        return { ok: false, error: '项目 JSON 文件无效或超过 5 MB。' };
      }
      return { ok: true, text: (await fs.readFile(filePath, 'utf8')).replace(/^\uFEFF/, '') };
      });
    } catch (_) {
      return { ok: false, error: '找不到上次导入的项目 JSON，请重新打开项目。' };
    }
  });


  handleProjectOperation('canvas-video:import', async(event,payload)=>{
    assertMainWindow(event);
    try {
      const source=payload?.path;
      const name=path.basename(source || payload?.name || 'video.mp4');
      const extension=path.extname(name).toLowerCase();
      if(!['.mp4','.webm','.mov'].includes(extension))throw new Error('视频支持 MP4、WebM 和 MOV');
      let bytes;
      if(source){if(!path.isAbsolute(source))throw new Error('视频路径无效');const info=await fs.stat(source);if(!info.isFile() || info.size>100*1024*1024)throw new Error('视频文件必须小于 100 MB');bytes=await fs.readFile(source);}
      else {bytes=Buffer.from(payload?.bytes || []);}
      if(!bytes.length || bytes.length>100*1024*1024)throw new Error('视频文件必须小于 100 MB');
      let base,projectPath=payload?.projectPath || '';
      if(projectPath){if(!path.isAbsolute(projectPath)||path.extname(projectPath).toLowerCase()!=='.json'||!(await fs.stat(projectPath)).isFile())throw new Error('项目路径无效');base=path.dirname(projectPath);}
      else {base=app.getPath('userData');projectPath=path.join(base,'canvas-local.json');try{await fs.writeFile(projectPath,'{}',{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}}
      const assetPath=await storeVideo(base,bytes,extension);
      return {ok:true,name,assetPath,projectPath};
    }catch(error){return {ok:false,error:error.message};}
  });

  handleProjectOperation('canvas-audio:import', async(event,payload)=>{
    assertMainWindow(event);
    try {
      const source=payload?.path;
      const name=path.basename(source || payload?.name || 'audio.mp3');
      const extension=path.extname(name).toLowerCase();
      if(!['.wav','.mp3','.m4a','.aac','.ogg','.flac','.webm'].includes(extension))throw new Error('不支持该音频格式');
      let bytes;
      if(source){if(!path.isAbsolute(source))throw new Error('音频路径无效');const info=await fs.stat(source);if(!info.isFile() || info.size>100*1024*1024)throw new Error('音频文件必须小于 100 MB');bytes=await fs.readFile(source);}
      else {bytes=Buffer.from(payload?.bytes || []);}
      if(!bytes.length || bytes.length>100*1024*1024)throw new Error('音频文件必须小于 100 MB');
      let base,projectPath=payload?.projectPath || '';
      if(projectPath){if(!path.isAbsolute(projectPath)||path.extname(projectPath).toLowerCase()!=='.json'||!(await fs.stat(projectPath)).isFile())throw new Error('项目路径无效');base=path.dirname(projectPath);}
      else {base=app.getPath('userData');projectPath=path.join(base,'canvas-local.json');try{await fs.writeFile(projectPath,'{}',{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}}
      const assetPath=await storeAudio(base,bytes,extension);
      return {ok:true,name,assetPath,projectPath};
    }catch(error){return {ok:false,error:error.message};}
  });

  ipcMain.handle('canvas-image:save', async (event, url) => {
    assertMainWindow(event);
    const source = fileURLToPath(url);
    if (!/\.(png|jpe?g|webp|gif)$/i.test(source) || !(await fs.stat(source)).isFile()) throw new Error('图片文件无效。');
    const choice = await dialog.showSaveDialog(mainWindow, { title:'图片另存为', defaultPath:path.basename(source) });
    if (choice.canceled || !choice.filePath) return false;
    if (path.resolve(source) !== path.resolve(choice.filePath)) await fs.copyFile(source, choice.filePath);
    return true;
  });

  ipcMain.handle('canvas-image:reveal', async (event, payload) => {
    assertMainWindow(event);
    try {
      let source;
      if (payload?.assetPath && payload?.projectPath) {
        if (!path.isAbsolute(payload.projectPath)) throw new Error('项目路径无效');
        const base = await fs.realpath(path.dirname(payload.projectPath));
        source = await fs.realpath(path.resolve(base, payload.assetPath));
        if (!pathIsWithin(base, source)) throw new Error('图片路径超出项目目录');
      } else if (typeof payload?.source === 'string' && payload.source.startsWith('file:')) {
        source = await fs.realpath(fileURLToPath(payload.source));
      } else throw new Error('图片尚未保存为本地文件，请先保存项目');
      if (!/\.(png|jpe?g|webp|gif)$/i.test(source) || !(await fs.stat(source)).isFile()) throw new Error('图片文件无效');
      shell.showItemInFolder(source);
      return {ok:true};
    } catch (error) { return {ok:false,error:error.message}; }
  });
  ipcMain.handle('canvas-image:copy-many',async(event,items)=>{
    assertMainWindow(event);await projectWriteQueue;
    try{
      if(!Array.isArray(items)||items.length<2||items.length>100)throw Error('请选择2至100张图片');
      const files=[];
      for(const item of items){const project=await fs.realpath(item.projectPath),base=path.dirname(project);if(!pathIsWithin(projectStore.ROOT,project))throw Error('项目路径无效');const file=await fs.realpath(path.resolve(base,item.assetPath));if(!pathIsWithin(base,file)||!/[.](png|jpe?g|webp|gif)$/i.test(file)||!(await fs.stat(file)).isFile())throw Error('图片路径无效');if(!files.includes(file))files.push(file);}
      const directory=path.join(app.getPath('userData'),'clipboard-images');await fs.mkdir(directory,{recursive:true});const staged=[];
      for(const file of files){const info=await fs.stat(file);if(info.size>100*1024*1024)throw Error('复制图片需小于100MB');const bytes=await fs.readFile(file),name=createHash('sha256').update(bytes).digest('hex')+path.extname(file).toLowerCase(),destination=path.join(directory,name);try{await fs.writeFile(destination,bytes,{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}staged.push(destination);}
      const json=Buffer.from(JSON.stringify(staged),'utf8').toString('base64');
      const script=`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Windows.Forms; $paths=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${json}'))); $list=New-Object System.Collections.Specialized.StringCollection; foreach($file in $paths){[void]$list.Add($file)}; $data=New-Object System.Windows.Forms.DataObject; $data.SetFileDropList($list); $effect=New-Object System.IO.MemoryStream; $effect.Write([byte[]](1,0,0,0),0,4); $effect.Position=0; $data.SetData('Preferred DropEffect',$effect); [System.Windows.Forms.Clipboard]::SetDataObject($data,$true,10,100); $actual=[System.Windows.Forms.Clipboard]::GetFileDropList(); if($actual.Count -ne $list.Count){throw '剪贴板图片数量核对失败'}; foreach($file in $list){if(!$actual.Contains($file)){throw '剪贴板图片路径核对失败'}}; Write-Output ('VERIFIED:'+ $actual.Count)`;
      const output=await new Promise((resolve,reject)=>require('node:child_process').execFile('powershell.exe',['-NoProfile','-STA','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true},(error,stdout,stderr)=>error?reject(new Error(stderr.trim() || error.message)):resolve(stdout)));
      if(!output.includes('VERIFIED:'+staged.length))throw Error('剪贴板复制未通过核对');
      for(const entry of await fs.readdir(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isFile()&&/^[a-f0-9]{64}\.[a-z0-9]+$/.test(entry.name)&&!staged.includes(file))await fs.unlink(file);}
      return {ok:true,count:files.length};
    }catch(error){return {ok:false,error:error.message};}
  });
  ipcMain.handle('canvas-image:copy', async (event, bytes) => {
    assertMainWindow(event);
    try {
      if (typeof bytes === 'string') {
        const source = fileURLToPath(bytes);
        if (!/\.(png|jpe?g|webp|gif)$/i.test(source)) throw new Error('图片文件无效');
        const info = await fs.stat(source);
        if (!info.isFile() || info.size > 100 * 1024 * 1024) throw new Error('复制图片需小于 100 MB');
        bytes = new Uint8Array(await fs.readFile(source));
      }
      if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 100 * 1024 * 1024) throw new Error('复制图片需小于 100 MB');
      const image = nativeImage.createFromBuffer(Buffer.from(bytes));
      if (image.isEmpty()) throw new Error('图片无法读取');
      await clipboard.write([new ClipboardItem({'image/png':new Blob([image.toPNG()],{type:'image/png'})})]);
      return {ok:true};
    } catch (error) { return {ok:false,error:error.message}; }
  });
  ipcMain.handle('canvas-image:paste', async (event, bytes) => {
    assertMainWindow(event);
    try {
      if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('粘贴图片需小于 20 MB');
      const image = nativeImage.createFromBuffer(Buffer.from(bytes));
      if (image.isEmpty()) throw new Error('剪贴板图片无法读取');
      const png = image.toPNG();
      if (png.length > 20 * 1024 * 1024) throw new Error('粘贴图片需小于 20 MB');
      const name = 'paste-' + createHash('sha256').update(png).digest('hex') + '.png';
      const directory = path.join(app.getPath('userData'), 'image-imports');
      await fs.mkdir(directory, { recursive:true });
      const filePath = path.join(directory, name);
      try { await fs.writeFile(filePath, png, { flag:'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      return { ok:true,path:filePath,name:'粘贴图片.png' };
    } catch (error) { return { ok:false,error:error.message }; }
  });
  ipcMain.handle('canvas-image:preview', async (event, filePath) => {
    assertMainWindow(event);
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || !/\.(png|jpe?g|webp|gif)$/i.test(filePath)) return '';
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > 20 * 1024 * 1024) return '';
    const bytes = await fs.readFile(filePath);
    return `data:${projectAssetMimeType(filePath)};base64,${bytes.toString('base64')}`;
  });

}

function createWindow() {
  canvasCloseApproved=false;
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 780,
    minHeight: 620,
    title: APP_TITLE,
    icon: path.join(__dirname, 'assets', process.platform === 'win32' ? 'app-icon.ico' : 'app-icon.png'),
    backgroundColor: '#151619',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== pathToFileURL(INDEX_PATH).href) event.preventDefault();
  });
  mainWindow.on('closed', () => { clearCanvasCloseTimer();canvasClosePending=false;mainWindow = null; });
  mainWindow.on('close',event=>{
    if(canvasCloseApproved)return;
    event.preventDefault();
    if(canvasClosePending)return;
    canvasClosePending=true;
    mainWindow.webContents.send('canvas:prepare-close');
    startCanvasCloseTimer();
  });
  mainWindow.on('focus',()=>{if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.focus();});
  mainWindow.loadFile(INDEX_PATH);
}

app.commandLine.appendSwitch('disk-cache-size', String(64 * 1024 * 1024));
const ownsSingleInstance=app.requestSingleInstanceLock();
if(!ownsSingleInstance)app.quit();
else app.on('second-instance',()=>{
  if(!mainWindow || mainWindow.isDestroyed())return;
  if(mainWindow.isMinimized())mainWindow.restore();
  mainWindow.show();mainWindow.focus();
});
if(ownsSingleInstance) app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const legacyScripts=LEGACY_PROJECT_ROOT,scripts=PROJECT_ROOT;
  try {await fs.access(scripts);}catch(error){if(error.code!=='ENOENT')throw error;try{await fs.rename(legacyScripts,scripts);}catch(moveError){if(moveError.code!=='ENOENT')throw moveError;}}
  await fs.mkdir(scripts,{recursive:true});
  projectStore.ROOT=await fs.realpath(scripts);
  const oldReferenceDirectory=path.join(app.getPath('userData'),'reference-library');
  const referenceDirectory=REFERENCE_ROOT;
  await fs.mkdir(referenceDirectory,{recursive:true});
  const referenceMigrationMarker=path.join(referenceDirectory,'.legacy-imported');
  try {await fs.access(referenceMigrationMarker);}catch(error){
    if(error.code!=='ENOENT')throw error;
    try {await fs.cp(oldReferenceDirectory,referenceDirectory,{recursive:true,force:false,errorOnExist:false});}catch(copyError){if(copyError.code!=='ENOENT')throw copyError;}
    await referenceLibrary.organize();
    await fs.writeFile(referenceMigrationMarker,'1','utf8');
  }
  await referenceLibrary.organize();
  for(const project of await projectStore.list())await undoAssets.prune(project.path);
  storagePolicy = createStoragePolicy(app.getPath('userData'));
  app.setName(APP_TITLE);
  installIpcHandlers();
  createWindow(); writeCanvasRuntimeState();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(error => {
  console.error('桌面程序启动失败：', error);
  app.quit();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', event => {
  if(!ownsSingleInstance)return;
  if(mainWindow&&!mainWindow.isDestroyed()&&!canvasCloseApproved){event.preventDefault();mainWindow.close();return;}
  if (!projectQuitFlushed) {
    event.preventDefault();
    projectWriteQueue.catch(()=>{}).finally(() => {projectQuitFlushed=true;app.quit();});
    return;
  }
  writeCanvasRuntimeState(true);
});
