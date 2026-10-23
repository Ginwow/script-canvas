const fs=require('node:fs/promises');
const path=require('node:path');
const owned=/^assets\/\.undo\/(?:audio\/)?[a-f0-9]{64}\.[a-z0-9]+$/;
function references(value,keep){
 if(typeof value==='string'){if(owned.test(value))keep.add(value);return;}
 if(Array.isArray(value))for(const item of value)references(item,keep);
 else if(value&&typeof value==='object')for(const item of Object.values(value))references(item,keep);
}
async function prune(projectPath,history=[]){
 const project=JSON.parse(await fs.readFile(projectPath,'utf8')),keep=new Set(history.filter(p=>owned.test(p)));
 references(project,keep);
 const base=path.dirname(projectPath),directory=path.join(base,'assets','.undo');
 let entries;try{if((await fs.lstat(directory)).isSymbolicLink())throw Error('撤销目录不能为符号链接');entries=await fs.readdir(directory,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return 0;throw error;}
 const real=await fs.realpath(directory),relative=path.relative(await fs.realpath(base),real);if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('撤销目录超出项目');
 let removed=0;
 for(const entry of entries){
  const asset='assets/.undo/'+entry.name;
  if(entry.isFile()&&owned.test(asset)&&!keep.has(asset)){await fs.unlink(path.join(real,entry.name));removed++;}
  else if(entry.name==='audio'&&entry.isDirectory()&&!entry.isSymbolicLink()){
   const audioDirectory=path.join(real,entry.name);
   for(const audio of await fs.readdir(audioDirectory,{withFileTypes:true})){
    const audioAsset=asset+'/'+audio.name;
    if(audio.isFile()&&owned.test(audioAsset)&&!keep.has(audioAsset)){await fs.unlink(path.join(audioDirectory,audio.name));removed++;}
   }
   if(!(await fs.readdir(audioDirectory)).length)await fs.rmdir(audioDirectory);
  }
 }
 if(!(await fs.readdir(real)).length)await fs.rmdir(real);
 return removed;
}
module.exports={prune};
