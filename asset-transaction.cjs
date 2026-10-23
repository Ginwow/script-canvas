const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const journalName = '.canvas-save-transaction';
const accessQueues=new Map();
// Short per-project gate: preparation is outside it; publication and reads are inside.
async function withStableRead(base, operation) {
  const key=path.resolve(base).toLowerCase(), previous=accessQueues.get(key)||Promise.resolve();
  let release;const current=new Promise(resolve=>{release=resolve;});accessQueues.set(key,current);
  await previous;
  try{return await operation();}finally{release();if(accessQueues.get(key)===current)accessQueues.delete(key);}
}

function target(base, relative) {
  const file = path.resolve(base, relative), rel = path.relative(base, file);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('事务目标超出项目');
  return file;
}
async function replace(file, bytes) {
  await fs.mkdir(path.dirname(file), {recursive:true});
  const temp = file + '.' + randomUUID() + '.writing';
  try { await fs.writeFile(temp, bytes); await fs.rename(temp, file); }
  finally { await fs.unlink(temp).catch(e => { if(e.code !== 'ENOENT') throw e; }); }
}
async function recoverUnlocked(base) {
  // Only UUID-named retired journals belong to us; they no longer carry live rollback state.
  for(const entry of await fs.readdir(base,{withFileTypes:true})) {
    if(entry.isDirectory() && !entry.isSymbolicLink() && /^\.canvas-save-transaction\.completed-[a-f0-9-]{36}$/.test(entry.name)) {
      await fs.rm(target(base,entry.name),{recursive:true,force:true});
    }
  }
  const directory = path.join(base, journalName);
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(path.join(directory,'manifest.json'),'utf8')); }
  catch(e) {
    if(e.code === 'ENOENT') {
      // Recovery is invoked only at startup or by the serialized save/open path,
      // never by read callbacks during an active preparation. No manifest means
      // publication has not begun, so interrupted staging can be discarded.
      await fs.rm(directory,{recursive:true,force:true});return;
    }
    throw e;
  }
  let committed = false;
  try { await fs.access(path.join(directory,'committed')); committed = true; } catch(e) { if(e.code !== 'ENOENT') throw e; }
  if (!committed) for (const [index, entry] of manifest.entries.entries()) {
    const file = target(base, entry.relative);
    if(entry.existed) await replace(file, await fs.readFile(path.join(directory,index+'.old')));
    else await fs.unlink(file).catch(e => { if(e.code !== 'ENOENT') throw e; });
  }
  // Retire the journal atomically before deleting backups: interruption during
  // cleanup must never leave a live manifest with missing rollback bytes.
  const retired=directory+'.completed-'+randomUUID();
  await fs.rename(directory,retired);
  await fs.rm(retired,{recursive:true,force:true});
}
async function recover(base) { return withStableRead(base,()=>recoverUnlocked(base)); }
// All old bytes are backed up before the first destination is replaced.
// An interrupted save rolls back on the next open/save, including its JSON.
async function commit(base, writes, checkpoint = async () => {}) {
  await recover(base);
  const directory = path.join(base,journalName);
  await fs.mkdir(directory,{recursive:true});
  const entries = [];
  try {
    for(const [relative,bytes] of writes) {
      const index=entries.length, file=target(base,relative);
      let old;
      try { old=await fs.readFile(file); } catch(e) { if(e.code !== 'ENOENT') throw e; }
      if(old?.equals(bytes)) continue;
      entries.push({relative,existed:old !== undefined});
      if(old !== undefined) await fs.writeFile(path.join(directory,index+'.old'),old);
      await fs.writeFile(path.join(directory,index+'.new'),bytes);
    }
    if(!entries.length) {await fs.rm(directory,{recursive:true,force:true});return;}
    await replace(path.join(directory,'manifest.json'),Buffer.from(JSON.stringify({entries})));
    await checkpoint('prepared');
    await withStableRead(base,async()=>{
    try {
    for(const [index,entry] of entries.entries()) {
      await replace(target(base,entry.relative),await fs.readFile(path.join(directory,index+'.new')));
      await checkpoint('applied',index);
    }
    await replace(path.join(directory,'committed'),Buffer.from('1'));
    } catch(error) { await recoverUnlocked(base); throw error; }
    await recoverUnlocked(base);
    });
  } catch(error) { await recover(base); throw error; }
}
module.exports={commit,recover,withStableRead};
