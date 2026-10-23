const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { imageFingerprint, rememberImageFingerprint } = require('./png-storage.cjs');
const { isAudioAssetPath } = require('./audio-storage.cjs');
const { createRealPathResolver } = require('./data-paths.cjs');

async function writeIfChanged(file, bytes) {
  try { if ((await fs.readFile(file)).equals(bytes)) return; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary=file+'.'+require('node:crypto').randomUUID()+'.writing';
  try {await fs.writeFile(temporary,bytes);await fs.rename(temporary,file);}
  finally {await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}

// Gather sources before writing: changing the numbering may swap existing names.
async function nameStoryboardAssets(base, state, writes = null) {
  const resolveReal=createRealPathResolver();base=await resolveReal(base);
  const nodes = state.nodes, edges = state.connections, byId = new Map(nodes.map(n => [n.id,n]));
  const children = id => edges.filter(e => e.fromId === id).map(e => byId.get(e.toId)).filter(Boolean);
  const shots = nodes.filter(n => n.kind === 'shot');
  const entries = [], claimed = new Set();
  const number = (title, fallback, label) => String(Number((title || '').match(new RegExp(label+'\\s*0*(\\d+)'))?.[1]) || fallback).padStart(2,'0');
  const imageSources = new Map();
  for (const node of nodes.filter(n=>n.kind==='asset' && /\.(png|jpe?g|webp|gif)$/i.test(n.assetPath || ''))) {
    const sourceBase = await resolveReal(path.dirname(node.projectPath || state.projectSource.path));
    const source = await fs.realpath(path.resolve(sourceBase,node.assetPath));
    const relative = path.relative(sourceBase,source);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw Error('素材路径超出源项目');
    imageSources.set(node.id,{bytes:await fs.readFile(source),extension:path.extname(source).toLowerCase(),hash:await imageFingerprint(source),sourceBase});
  }
  const safeName = title => {
    let name = (title || '人物').replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/[ .]+$/,'').trim().slice(0,80) || '人物';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) name = '_' + name;
    return name;
  };
  // Character setting images get first choice of the shared filename.
  for (const character of nodes.filter(n=>n.kind==='character')) {
    const hashes = new Map();
    for (const node of children(character.id).filter(n=>imageSources.has(n.id))) {
      if (claimed.has(node.id)) continue;
      const hash = imageSources.get(node.id).hash;
      if (!hashes.has(hash)) hashes.set(hash,hashes.size+1);
      claimed.add(node.id);
      entries.push({node,type:'参考图',stem:safeName(character.title)+String(hashes.get(hash)).padStart(2,'0')});
    }
  }
  for (const [kind,label,type] of [['cover-group','封面','参考图'],['video-group','成片','视频']]) {
    let count=0;
    for (const group of nodes.filter(n=>n.kind===kind)) for (const node of children(group.id)) {
      const eligible=type==='参考图'?imageSources.has(node.id):node.kind==='asset' && !isAudioAssetPath(node.assetPath) && /\.(mp4|webm|mov)$/i.test(node.assetPath || '');
      if(!eligible || claimed.has(node.id))continue;
      claimed.add(node.id);entries.push({node,type,stem:label+String(++count).padStart(2,'0')});
    }
  }
  for (const [si,shot] of shots.entries()) {
    const boards = children(shot.id).filter(n => n.kind === 'storyboard');
    for (const [bi,board] of boards.entries()) {
      const prefix = '场景'+number((shot.title || '').replace(/^镜头/, '场景'),si+1,'场景')+'_镜头'+number((board.title || '').replace(/^分镜/, '镜头'),bi+1,'镜头');
      const counts = {参考图:0,提示词:0,视频:0};
      const add = (node,type) => {
        if(claimed.has(node.id))return;
        claimed.add(node.id);
        entries.push({node,type,stem:prefix+'_'+type+String(++counts[type]).padStart(2,'0')});
      };
      for(const node of children(board.id)) {
        if(node.kind === 'asset' && /\.(png|jpe?g|webp|gif)$/i.test(node.assetPath || ''))add(node,'参考图');
        else if(node.kind === 'asset' && !isAudioAssetPath(node.assetPath) && /\.(mp4|webm|mov)$/i.test(node.assetPath || ''))add(node,'视频');
        else if(['text','prompt'].includes(node.kind)) {
          add(node,'提示词');
          for(const video of children(node.id))if(video.kind === 'asset' && !isAudioAssetPath(video.assetPath) && /\.(mp4|webm|mov)$/i.test(video.assetPath || ''))add(video,'视频');
        }
      }
    }
  }
  for (const node of nodes.filter(n=>imageSources.has(n.id) && !claimed.has(n.id))) {
    claimed.add(node.id); entries.push({node,type:'参考图',stem:path.basename(node.assetPath,path.extname(node.assetPath))});
  }
  for(const entry of entries) {
    if(entry.type === '提示词'){entry.bytes=Buffer.from(entry.node.text || '','utf8');entry.extension='.txt';continue;}
    if (imageSources.has(entry.node.id)) { Object.assign(entry,imageSources.get(entry.node.id)); continue; }
    const sourceBase=await resolveReal(path.dirname(entry.node.projectPath || state.projectSource.path));
    const source=await fs.realpath(path.resolve(sourceBase,entry.node.assetPath));
    const relative=path.relative(sourceBase,source);
    if(relative.startsWith('..') || path.isAbsolute(relative))throw new Error('素材路径超出源项目');
    entry.bytes=await fs.readFile(source);entry.extension=path.extname(source).toLowerCase();
  }
  const destinations=new Map();
  const key = value => value.replace(/\\/g,'/').toLowerCase();
  function allocate(relative, identity) {
    const extension=path.extname(relative), stem=relative.slice(0,-extension.length);
    let candidate=relative, suffix=2;
    while(destinations.has(key(candidate)) && destinations.get(key(candidate))!==identity) candidate=stem+'_'+suffix+++extension;
    destinations.set(key(candidate),identity);return candidate;
  }
  // Unbound videos retain their paths; numbered names must not overwrite them.
  for(const node of nodes.filter(n=>n.kind==='asset' && !claimed.has(n.id) && !isAudioAssetPath(n.assetPath) && /\.(mp4|webm|mov)$/i.test(n.assetPath || ''))) {
    const bytes=await fs.readFile(path.resolve(base,node.assetPath));
    destinations.set(key(node.assetPath),'video:'+createHash('sha256').update(bytes).digest('hex'));
  }
  const videoHashes=new Map(), imageHashes=new Map(), imagePaths=new Map(), writtenImages=new Set(), updates=[], cleanup=[];
  for(const entry of entries) {
    const folder=entry.type === '提示词'?'prompts':entry.type === '视频'?'videos':'generated';
    let relative='assets/'+folder+'/'+entry.stem+entry.extension;
    if (entry.type === '参考图') {
      if (imageHashes.has(entry.hash)) relative = imageHashes.get(entry.hash);
      else {
        relative=allocate(relative,'image:'+entry.hash);
        imageHashes.set(entry.hash,relative); imagePaths.set(relative,entry.hash);
      }
    }
    if(entry.type === '视频') {
      const hash=createHash('sha256').update(entry.bytes).digest('hex');
      if(videoHashes.has(hash))relative=videoHashes.get(hash);else {relative=allocate(relative,'video:'+hash);videoHashes.set(hash,relative);}
    }
    if(entry.type==='提示词') relative=allocate(relative,'prompt:'+entry.node.id);
    if(!writes) await fs.mkdir(path.join(base,'assets',folder),{recursive:true});
    if (entry.type !== '参考图' || !writtenImages.has(relative)) {if(writes) writes.set(relative,entry.bytes);else await writeIfChanged(path.join(base,relative),entry.bytes);}
    if (entry.type === '参考图' && !writtenImages.has(relative)) { writtenImages.add(relative); if(!writes) await rememberImageFingerprint(path.join(base,relative),entry.hash); }
    if(entry.type === '提示词') {
      // Remove only an identical legacy export after the project has committed.
      const legacy = relative.replace(/场景(\d+)_镜头(\d+)_/, '镜头$1_分镜$2_');
      if (legacy !== relative) {
        try { if ((await fs.readFile(path.join(base, legacy))).equals(entry.bytes)) cleanup.push(legacy); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
    if(entry.type !== '提示词') {
      const old=entry.node.assetPath;
      entry.node.assetPath=relative;
      if(entry.type === '视频' || entry.type === '参考图') entry.node.fileName=path.basename(relative);
      updates.push({id:entry.node.id,assetPath:relative,projectPath:state.projectSource.path});
      if(old!==relative && ((entry.type==='参考图' && path.resolve(entry.sourceBase)===path.resolve(base) && /^assets\/(?!\.undo\/)[^\\]+$/.test(old)) || /^assets\/(generated|videos)\/[^/]+$/.test(old)))cleanup.push(old);
    }
  }
  // An unbound duplicate video must share the named file too.
  for(const node of nodes.filter(n=>n.kind==='asset' && !isAudioAssetPath(n.assetPath) && /\.(mp4|webm|mov)$/i.test(n.assetPath || '') && !claimed.has(n.id))) {
    const old=node.assetPath, bytes=await fs.readFile(path.resolve(base,old));
    const shared=videoHashes.get(createHash('sha256').update(bytes).digest('hex'));
    if(shared && old!==shared){node.assetPath=shared;node.fileName=path.basename(shared);updates.push({id:node.id,assetPath:shared,projectPath:state.projectSource.path});if(/^assets\/videos\/[^/]+$/.test(old))cleanup.push(old);}
  }
  // Retire old duplicate image files only when an identical retained image exists.
  async function collectDuplicateImages(directory) {
    let files;
    try { files = await fs.readdir(directory,{withFileTypes:true}); }
    catch (error) { if (error.code==='ENOENT') return; throw error; }
    for (const file of files) {
      if (file.name === '.undo' || file.isSymbolicLink()) continue;
      const absolute = path.join(directory,file.name);
      if (file.isDirectory()) { await collectDuplicateImages(absolute); continue; }
      if (!file.isFile() || !/\.(png|jpe?g|webp|gif)$/i.test(file.name)) continue;
      const relative = path.relative(base,absolute).split(path.sep).join('/');
      if ([...imagePaths.keys()].some(p=>key(p)===key(relative))) continue;
      const canonical = imageHashes.get(await imageFingerprint(absolute));
      if (canonical && relative !== canonical) cleanup.push(relative);
    }
  }
  await collectDuplicateImages(path.join(base,'assets'));
  const retained=new Set(nodes.map(n=>n.assetPath).filter(Boolean).map(key));
  return {updates,cleanup:cleanup.filter(p=>!retained.has(key(p)))};
}
module.exports={nameStoryboardAssets};
