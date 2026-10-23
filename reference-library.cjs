const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {prepareImageAsync,imageFingerprint} = require('./png-storage.cjs');
const { REFERENCE_ROOT: ROOT } = require('./data-paths.cjs');
const categories = ['人物','家具','交通工具','场景','服饰','道具','其它','参考音色','BGM'];
const imagePattern = /\.(png|jpe?g|webp|gif)$/i;
const audioPattern = /\.(wav|mp3|m4a|aac|ogg|flac)$/i;
const categoryOf = (value, file) => audioPattern.test(file) ? (value === 'BGM' ? 'BGM' : '参考音色') : categories.includes(value) && !['参考音色','BGM'].includes(value) ? value : '其它';
let queue = Promise.resolve();
function serial(task) { const result=queue.then(task);queue=result.catch(()=>{});return result; }
async function transfer(source, category) {
  const real = await fs.realpath(source), root=await fs.realpath(ROOT);
  const relative=path.relative(root,real);
  if(!relative || relative.startsWith('..') || path.isAbsolute(relative) || !(await fs.stat(real)).isFile())throw new Error('素材不在参考素材库中');
  let destination=path.join(root,category,path.basename(real));
  if(real!==destination) {
    try {await fs.copyFile(real,destination,require('node:fs').constants.COPYFILE_EXCL);}
    catch(error){if(error.code!=='EEXIST')throw error;const [a,b]=await Promise.all([fs.readFile(real),fs.readFile(destination)]);if(!a.equals(b)){
      const hash=createHash('sha256').update(a).digest('hex');
      destination=path.join(root,category,path.basename(real,path.extname(real))+'-'+hash+path.extname(real).toLowerCase());
      try{await fs.writeFile(destination,a,{flag:'wx'});}catch(collision){if(collision.code!=='EEXIST'||!(await fs.readFile(destination)).equals(a))throw collision;}
    }}
    for(const suffix of ['.name.txt','.category.txt']) {
      try {await fs.copyFile(real+suffix,destination+suffix);await fs.unlink(real+suffix);}catch(error){if(error.code!=='ENOENT')throw error;}
    }
    await fs.unlink(real);
  }
  await fs.writeFile(destination+'.category.txt',category,'utf8');
  return destination;
}
async function organize() {
  await fs.mkdir(ROOT,{recursive:true});
  for(const category of categories)await fs.mkdir(path.join(ROOT,category),{recursive:true});
  for(const entry of await fs.readdir(ROOT,{withFileTypes:true})) {
    if(!entry.isFile() || !imagePattern.test(entry.name) && !audioPattern.test(entry.name))continue;
    const file=path.join(ROOT,entry.name);
    let category='其它';try{category=await fs.readFile(file+'.category.txt','utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
    await transfer(file,categoryOf(category,entry.name));
  }
  for(const category of categories) {
    const seen=new Map();
    const files=(await fs.readdir(path.join(ROOT,category))).filter(name=>imagePattern.test(name)).sort((a,b)=>a.length-b.length);
    for(const name of files) {
      const file=path.join(ROOT,category,name),hash=await imageFingerprint(file);
      if(!seen.has(hash)){seen.set(hash,file);continue;}
      const backup=path.join(path.dirname(ROOT),'recovery','reference-library-duplicates',category);
      await fs.mkdir(backup,{recursive:true});
      for(const suffix of ['', '.name.txt','.category.txt']) {
        try{await fs.copyFile(file+suffix,path.join(backup,name+suffix));await fs.unlink(file+suffix);}catch(error){if(error.code!=='ENOENT')throw error;}
      }
    }
  }
}
async function listInternal() {
  await organize(); const items=[];
  for(const category of categories)for(const entry of await fs.readdir(path.join(ROOT,category),{withFileTypes:true})) {
    if(!entry.isFile() || !imagePattern.test(entry.name) && !audioPattern.test(entry.name))continue;
    const file=path.join(ROOT,category,entry.name),info=await fs.stat(file);
    let name=entry.name;try{name=await fs.readFile(file+'.name.txt','utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
    items.push({path:file,name,category,type:audioPattern.test(file)?'audio':'image',size:info.size,createdAt:info.mtimeMs});
  }
  return items.sort((a,b)=>b.createdAt-a.createdAt);
}
async function saveInternal(source, category) {
  if(typeof source!=='string')throw new Error('请选择本地素材');
  if(source.startsWith('file:'))source=require('node:url').fileURLToPath(source);
  if(!path.isAbsolute(source) || !imagePattern.test(source) && !audioPattern.test(source))throw new Error('请选择图片或参考音色音频');
  const info=await fs.stat(source),audio=audioPattern.test(source);
  if(!info.isFile() || info.size>(audio?100:20)*1024*1024)throw new Error(audio?'音频需小于100MB':'参考图需小于20MB');
  await organize();
  const raw=await fs.readFile(source),prepared=audio?null:await prepareImageAsync(raw);
  const bytes=prepared?.bytes || raw, hash=prepared?.hash || createHash('sha256').update(bytes).digest('hex');
  const extension=audio?path.extname(source).toLowerCase():'.png';
  category=categoryOf(category,source);
  if(!audio)for(const name of await fs.readdir(path.join(ROOT,category))) {
    const existing=path.join(ROOT,category,name);
    if(imagePattern.test(name) && await imageFingerprint(existing)===hash)return {path:existing,name:path.basename(source),category,type:'image',duplicate:true};
  }
  const destination=path.join(ROOT,category,hash+extension);
  let duplicate=false;
  try{await fs.writeFile(destination,bytes,{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;duplicate=true;}
  await fs.writeFile(destination+'.name.txt',path.basename(source),'utf8');
  await fs.writeFile(destination+'.category.txt',category,'utf8');
  return {path:destination,name:path.basename(source),category,type:audio?'audio':'image',duplicate};
}
module.exports={ROOT,categories,imagePattern,audioPattern,organize:()=>serial(organize),list:()=>serial(listInternal),save:(source,category)=>serial(()=>saveInternal(source,category)),categorize:(paths,category)=>serial(async()=>{
  await organize();if(!Array.isArray(paths)||paths.length>50||!categories.includes(category))throw new Error('分类参数无效');
  for(const source of paths)await transfer(source,categoryOf(category,source));return listInternal();
}),resolve:async source=>{
  const real=await fs.realpath(source),root=await fs.realpath(ROOT),relative=path.relative(root,real);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!imagePattern.test(real)&&!audioPattern.test(real))throw new Error('参考素材路径无效');
  return real;
}};
