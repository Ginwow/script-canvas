const { commit: commitAssets, recover: recoverAssets } = require('./asset-transaction.cjs');
const { prepareImageAsync } = require('./png-storage.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { storeVideo } = require('./video-storage.cjs');
const { storeAudio, isAudioAssetPath } = require('./audio-storage.cjs');
const { nameStoryboardAssets } = require('./asset-naming.cjs');
const { PROJECT_ROOT, rebaseManagedPath, createRealPathResolver } = require('./data-paths.cjs');
const ROOT = PROJECT_ROOT;
const savedMedia = new Map();
function namingProjection(state) {
  const boards=new Set(state.nodes.filter(n=>n.kind==='storyboard').map(n=>n.id));
  const prompts=new Set(state.connections.filter(e=>boards.has(e.fromId)).map(e=>e.toId));
  return JSON.stringify({nodes:state.nodes.map(n=>({id:n.id,kind:n.kind,
    title:['character','shot','storyboard'].includes(n.kind)?n.title:undefined,
    text:prompts.has(n.id)&&['text','prompt'].includes(n.kind)?n.text:undefined,
    assetPath:n.assetPath,projectPath:n.assetPath?n.projectPath:undefined,fileName:n.assetPath?n.fileName:undefined})),
    connections:state.connections.map(e=>({fromId:e.fromId,toId:e.toId})),source:state.projectSource?.path});
}
// Stat only: bytes and image fingerprints remain owned by the full naming pass.
// Inventory also catches changed/deleted prompt exports and newly added duplicates.
async function mediaSignature(real,state,resolveReal=createRealPathResolver()) {
  const records=[],seen=new Set();
  async function record(file) {if(seen.has(file))return;seen.add(file);const stat=await fs.stat(file);records.push([file,stat.size,stat.mtimeMs,stat.ctimeMs]);}
  await record(real);
  for(const node of state.nodes.filter(n=>n.kind==='asset'&&n.assetPath)) {
    const base=await resolveReal(path.dirname(node.projectPath||state.projectSource?.path||real)),candidate=path.resolve(base,node.assetPath);
    if(!within(base,candidate))throw new Error('素材路径超出源项目');
    const actual=await fs.realpath(candidate);if(!within(base,actual))throw new Error('素材路径超出源项目');
    await record(actual);
  }
  async function inventory(directory) {
    let entries;try{entries=await fs.readdir(directory,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return;throw error;}
    for(const entry of entries) {
      if(entry.name==='.undo'||entry.isSymbolicLink())continue;
      const file=path.join(directory,entry.name);
      if(entry.isDirectory())await inventory(file);else if(entry.isFile())await record(file);
    }
  }
  await inventory(path.join(path.dirname(real),'assets'));
  records.sort((a,b)=>a[0].localeCompare(b[0]));return JSON.stringify(records);
}
const within = (base,file) => { const relative=path.relative(base,file); return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative); };
function projectFileName(title) {
  const name=(title||'未命名项目').trim().replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/[ .]+$/,'');
  if(!name || name.length>100 || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new Error('剧本名不能作为文件夹名，请改用有效的剧本名（最多100字）');
  return name;
}
async function atomic(file,value) {
  const temp=file+'.writing'; await fs.writeFile(temp,JSON.stringify(value,null,2),'utf8'); await fs.rename(temp,file);
}
function projectFromState(state, previous) {
  const nodes=state.nodes, edges=state.connections;
  const ofKind=kind=>nodes.filter(n=>n.kind===kind);
  const images=id=>edges.filter(e=>e.fromId===id).map(e=>nodes.find(n=>n.id===e.toId)).filter(n=>n?.kind==='asset'&&n.assetPath&&/\.(png|jpe?g|webp|gif)$/i.test(n.assetPath))
    .map(n=>({path:n.assetPath,label:n.fileName||n.title||'参考图',role:n.imageRole}));
  const refs=list=>list.map(({role,...image})=>image);
  const oldShots=new Map((previous.shots||[]).map(s=>[s.id,s]));
  const oldImages=new Map((previous.storyboards||[]).flatMap(b=>[...(b.keyframes||[]),...(b.referenceImages||[])]).map(i=>[i.path,i]));
  const boardRefs=list=>refs(list).map(image=>oldImages.get(image.path)?.time?{...image,time:oldImages.get(image.path).time}:image);
  const project={format:'white-canvas-video-project',version:3,project:{title:ofKind('script')[0]?.text?.trim().slice(0,300)||previous.project.title},
    synopsis:ofKind('plot')[0]?.text||'',visualStyle:ofKind('style')[0]?.text||'',
    characters:ofKind('character').map(n=>({id:n.id,name:n.title||'人物',setting:n.text||'',referenceImages:refs(images(n.id))})),
    shots:ofKind('shot').map(n=>{const text=n.text||'',time=text.match(/^时间[：:]\s*(.*)$/m)?.[1]||oldShots.get(n.id)?.time||null;
      const description=text.includes('画面：')?text.slice(text.indexOf('画面：')+3):text;
      const title=time&&(n.title||'').endsWith(' · '+time)?n.title.slice(0,-(' · '+time).length):n.title||'';
      return {id:n.id,title,time,duration:n.duration||'',description};}),
    storyboards:ofKind('storyboard').map(n=>{const shotId=edges.find(e=>e.toId===n.id&&nodes.some(s=>s.id===e.fromId&&s.kind==='shot'))?.fromId;
      return {id:n.id,shotId,title:n.title||'',prompt:n.text||'',keyframes:boardRefs(images(n.id).filter(i=>i.role!=='storyboard-reference')),referenceImages:boardRefs(images(n.id).filter(i=>i.role==='storyboard-reference'))};}).filter(n=>n.shotId)};
  const codex=state.projectSource?.codex||previous.project.codex; if(codex)project.project.codex=codex;
  project.canvas={view:state.view,nodes:state.nodes.map(({projectPath,...node})=>node),connections:state.connections,shotLaneLayoutVersion:state.shotLaneLayoutVersion||0};
  return project;
}
async function read(file){return JSON.parse(await fs.readFile(file,'utf8'));}
async function migrate(source, state = null) {
  const resolveReal=createRealPathResolver();
  await fs.mkdir(ROOT,{recursive:true});const root=await resolveReal(ROOT);
  source=await rebaseManagedPath(source);
  const real=await fs.realpath(source); await recoverAssets(path.dirname(real)); const project=await read(real);
  if(project.format!=='white-canvas-video-project'||![2,3].includes(project.version))throw new Error('不是有效的画布项目');
  const title=projectFileName(project.project.title);
  const directory=path.join(root,title),destination=path.join(directory,title+'.json');
  if(real.toLowerCase()===destination.toLowerCase())return open(real);
  if(within(root,real) && path.dirname(path.dirname(real))===root) {
    try {await fs.access(destination);return open(destination);}catch(error){if(error.code!=='ENOENT')throw error;}
    const oldDirectory=path.dirname(real);
    if(oldDirectory!==directory) await fs.rename(oldDirectory,directory);
    const moved=path.join(directory,path.basename(real));
    if(moved!==destination)await fs.rename(moved,destination);
    const stateFile=path.join(directory,'画布状态.json');
    try {const saved=await read(stateFile);const oldPath=saved.projectSource.path;saved.projectSource.path=destination;for(const node of saved.nodes||[])if(node.projectPath===real||node.projectPath===oldPath)node.projectPath=destination;await atomic(stateFile,saved);}catch(error){if(error.code!=='ENOENT')throw error;}
    return open(destination);
  }
  await fs.mkdir(directory,{recursive:true});
  try { await fs.access(destination); return open(destination); } catch(error){if(error.code!=='ENOENT')throw error;}
  const references=[...(project.characters||[]).flatMap(c=>c.referenceImages||[]),...(project.storyboards||[]).flatMap(b=>[...(b.keyframes||[]),...(b.referenceImages||[])]),...(project.canvas?.nodes||[]).filter(n=>n.assetPath).map(n=>({path:n.assetPath}))];
  const base=path.dirname(real);
  for(const image of references){if(/\.(mp4|webm|mov)$/i.test(image.path)||isAudioAssetPath(image.path))continue;const candidate=path.resolve(base,image.path);if(!within(base,candidate))throw new Error('素材路径超出源项目');
    const actual=await fs.realpath(candidate);if(!within(base,actual))throw new Error('素材路径超出源项目');
    const target=path.resolve(directory,image.path);if(!within(directory,target))throw new Error('素材目标路径无效');
    await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,/\.(mp4|webm|mov)$/i.test(actual)?await fs.readFile(actual):(await prepareImageAsync(await fs.readFile(actual))).bytes);}
  for(const node of project.canvas?.nodes || []) if(node.kind==='asset'&&(/\.(mp4|webm|mov)$/i.test(node.assetPath || '')||isAudioAssetPath(node.assetPath))) {
    const sourcePath=await fs.realpath(path.resolve(base,node.assetPath));
    if(!within(base,sourcePath))throw new Error('视频素材路径超出源项目');
    node.assetPath=await (isAudioAssetPath(node.assetPath)?storeAudio:storeVideo)(directory,await fs.readFile(sourcePath),path.extname(sourcePath));
  }
  await fs.mkdir(path.join(directory,'assets'),{recursive:true});
  await atomic(destination,project);
  if(state?.nodes?.length) {
    for(const node of state.nodes.filter(n=>n.kind==='asset'&&n.assetPath&&n.projectPath)) {
      const assetBase=await resolveReal(path.dirname(node.projectPath)),candidate=path.resolve(assetBase,node.assetPath),target=path.resolve(directory,node.assetPath);
      if(!within(assetBase,candidate)||!within(directory,target))throw new Error('画布素材路径无效');
      const actual=await fs.realpath(candidate);if(!within(assetBase,actual))throw new Error('画布素材超出项目');
      if(/\.(mp4|webm|mov)$/i.test(node.assetPath)||isAudioAssetPath(node.assetPath))node.assetPath=await (isAudioAssetPath(node.assetPath)?storeAudio:storeVideo)(directory,await fs.readFile(actual),path.extname(actual));
      else {await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,(await prepareImageAsync(await fs.readFile(actual))).bytes);}
      node.projectPath=destination;
    }
    state.projectSource.path=destination;await save(destination,state);
  }
  return open(destination);
}
async function open(file) {
  const root=await fs.realpath(ROOT),real=await fs.realpath(file);if(!within(root,real)||path.extname(real)!=='.json')throw new Error('项目不在项目库中');
  await recoverAssets(path.dirname(real));
  let project=await read(real);let state=null;
  const legacy=path.join(path.dirname(real),'画布状态.json');
  if(project.canvas?.nodes?.length) state={...project.canvas,projectSource:{path:real,codex:project.project.codex||null},contextSelectionVersion:1,nodes:project.canvas.nodes.map(n=>({...n,projectPath:n.kind==='asset'?real:''}))};
  else try{state=await read(legacy);const upgraded=projectFromState(state,project);await atomic(real,upgraded);project=upgraded;}catch(error){if(error.code!=='ENOENT')throw error;}
  if(state){state.projectSource={...state.projectSource,path:real};for(const node of state.nodes)if(node.kind === 'asset')node.projectPath=real;}
  try{await fs.unlink(legacy);}catch(error){if(error.code!=='ENOENT')throw error;}
  await remember(real);
  return {projectPath:real,project,state};
}
async function list(){await fs.mkdir(ROOT,{recursive:true});const items=[];for(const dir of await fs.readdir(ROOT,{withFileTypes:true})){if(!dir.isDirectory())continue;
  const named=path.join(ROOT,dir.name,dir.name+'.json');let file=named;try{await fs.access(file);}catch(_){file=path.join(ROOT,dir.name,'项目.json');}try{const project=await read(file),stat=await fs.stat(file);items.push({path:file,title:project.project.title,updatedAt:stat.mtimeMs});}catch(_){}}
  return items.sort((a,b)=>b.updatedAt-a.updatedAt);}
// Preserve only history whose source this transaction will replace or retire.
// Immutable copies share the media/JSON transaction, so failed saves cannot
// acknowledge a remap whose bytes were never successfully published.
async function protectHistoryAssets(real, historyAssets, writes, cleanup, resolveReal) {
  const base=path.dirname(real),key=value=>value.replace(/\\/g,'/').toLowerCase();
  const replacements=new Map([...writes].map(([relative,bytes])=>[key(relative),bytes]));
  const retired=new Set(cleanup.map(key)),mappings=[],pinned=new Map();
  for(const item of Array.isArray(historyAssets)?historyAssets:[]) {
    if(typeof item?.projectPath!=='string'||typeof item.assetPath!=='string'||!path.isAbsolute(item.projectPath))continue;
    const relative=item.assetPath.replace(/\\/g,'/'),identity=key(relative);
    if(!/^assets\//i.test(relative)||/^assets\/\.undo\//i.test(relative)||(!replacements.has(identity)&&!retired.has(identity)))continue;
    let historyProject;
    try{historyProject=await resolveReal(item.projectPath);}catch(error){if(['ENOENT','ENOTDIR'].includes(error.code))continue;throw error;}
    if(historyProject.toLowerCase()!==real.toLowerCase())continue;
    const candidate=path.resolve(base,relative);if(!within(base,candidate))throw new Error('历史素材路径超出项目');
    let pinnedPath=pinned.get(identity);
    if(!pinnedPath) {
      const actual=await fs.realpath(candidate);if(!within(base,actual))throw new Error('历史素材路径超出项目');
      const bytes=await fs.readFile(actual);
      if(!retired.has(identity)&&replacements.get(identity)?.equals(bytes))continue;
      const hash=createHash('sha256').update(bytes).digest('hex');
      pinnedPath='assets/.undo/'+(isAudioAssetPath(relative)?'audio/':'')+hash+path.extname(relative).toLowerCase();
      // Reject symlink directories/files rather than let a staged write escape.
      let target=base;
      for(const part of pinnedPath.split('/')) {
        target=path.join(target,part);
        try{if((await fs.lstat(target)).isSymbolicLink())throw new Error('撤销素材路径不能为符号链接');}catch(error){if(error.code!=='ENOENT')throw error;}
      }
      if(!writes.has(pinnedPath)) {
        let existing;try{existing=await fs.readFile(path.join(base,pinnedPath));}catch(error){if(error.code!=='ENOENT')throw error;}
        if(existing&&!existing.equals(bytes))throw new Error('撤销素材内容校验失败');
        if(!existing)writes.set(pinnedPath,bytes);
      }
      pinned.set(identity,pinnedPath);
    }
    mappings.push({projectPath:item.projectPath,assetPath:item.assetPath,pinnedPath});
  }
  return mappings;
}
async function save(file,state,historyAssets=[]){const resolveReal=createRealPathResolver();file=await rebaseManagedPath(file,ROOT);const root=await resolveReal(ROOT),real=await resolveReal(file);if(!within(root,real)||path.extname(real)!=='.json')return {skipped:true};
  if(!state||!Array.isArray(state.nodes)||!Array.isArray(state.connections)||state.nodes.length>2000)throw new Error('画布保存数据无效');
  await recoverAssets(path.dirname(real));
  state=structuredClone(state);
  const previous=await read(real);
  const cached=savedMedia.get(real),projection=namingProjection(state);
  savedMedia.delete(real);
  const unchanged=cached&&cached.projection===projection&&cached.signature===await mediaSignature(real,state,resolveReal);
  const priorManagedPaths=state.nodes.filter(n=>n.kind==='asset'&&/^assets\/(generated|videos)\/[^/]+$/.test(n.assetPath || '')).map(n=>n.assetPath);
  const videoAssets=[];
  for(const node of state.nodes.filter(n=>n.kind==='asset'&&(/\.(mp4|webm|mov)$/i.test(n.assetPath || '')||isAudioAssetPath(n.assetPath)))) {
    const sourceBase=await resolveReal(path.dirname(node.projectPath || state.projectSource?.path || real));
    const candidate=path.resolve(sourceBase,node.assetPath);
    if(!within(sourceBase,candidate))throw new Error('视频素材路径超出源项目');
    const actual=await fs.realpath(candidate);
    if(!within(sourceBase,actual))throw new Error('视频素材路径超出源项目');
    const audio=isAudioAssetPath(node.assetPath);
    // Already-local audio keeps its stable path and original filename.
    if(path.resolve(sourceBase)!==path.dirname(real))node.assetPath=await (audio?storeAudio:storeVideo)(path.dirname(real),await fs.readFile(actual),path.extname(actual));
    node.projectPath=real;
    videoAssets.push({id:node.id,assetPath:node.assetPath,projectPath:real});
  }
  const writes=new Map();
  const named=unchanged?{cleanup:[]}:await nameStoryboardAssets(path.dirname(real),state,writes);
  const retainedPaths=new Set(state.nodes.map(n=>n.assetPath?.toLowerCase()).filter(Boolean));
  const cleanup=[...new Set([...named.cleanup,...priorManagedPaths.filter(p=>!retainedPaths.has(p.toLowerCase()))])];
  const historicalMappings=await protectHistoryAssets(real,historyAssets,writes,cleanup,resolveReal);
  const project=projectFromState(state,previous);
  writes.set(path.basename(real),Buffer.from(JSON.stringify(project,null,2)));
  await commitAssets(path.dirname(real),writes);
  // A last-opened marker is optional after the project has committed. Reporting
  // failure here would hide the remaps required to preserve in-memory history.
  try{await remember(real);}catch(error){console.warn('最近项目记录更新失败',error.message);}
  let cleanupSucceeded=true;
  for(const old of cleanup)try{await fs.unlink(path.join(path.dirname(real),old));}catch(error){if(error.code!=='ENOENT'){cleanupSucceeded=false;console.warn('旧素材清理失败',old,error.message);}}
  if(cleanupSucceeded)try{savedMedia.set(real,{projection:namingProjection(state),signature:await mediaSignature(real,state,resolveReal)});}catch(_){/* A concurrent external edit must leave the next save on the full path. */}
  const finalAssets=state.nodes.filter(n=>n.kind==='asset'&&n.assetPath).map(n=>({id:n.id,assetPath:n.assetPath,projectPath:real,fileName:n.fileName}));
  return {project,videoAssets:finalAssets,historyAssets:historicalMappings};}
async function remember(file){await atomic(path.join(ROOT,'.last-project.json'),{path:file});}
async function openLast(){let marker;try{marker=await read(path.join(ROOT,'.last-project.json'));}catch(error){if(error.code!=='ENOENT')throw error;const projects=await list();if(!projects.length)return {};marker={path:projects[0].path};}return open(await rebaseManagedPath(marker.path));}
module.exports={ROOT,list,open,openLast,migrate,save,projectFromState};
