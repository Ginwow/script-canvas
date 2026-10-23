const { inflateSync, deflateSync } = require('node:zlib');
const { createHash } = require('node:crypto');
const signature = Buffer.from('89504e470d0a1a0a', 'hex');
function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) { value ^= byte; for (let i=0;i<8;i++) value=(value>>>1)^((value&1)?0xedb88320:0); }
  return (value ^ 0xffffffff) >>> 0;
}
function parse(bytes) {
  if (!bytes.subarray(0,8).equals(signature)) throw Error('Not PNG');
  const chunks=[]; let offset=8;
  while(offset<bytes.length) {
    const size=bytes.readUInt32BE(offset); const end=offset+12+size;
    if(end>bytes.length) throw Error('Invalid PNG');
    const type=bytes.toString('ascii',offset+4,offset+8),data=bytes.subarray(offset+8,end-4);
    if(crc(bytes.subarray(offset+4,end-4))!==bytes.readUInt32BE(end-4))throw Error('Invalid CRC');
    chunks.push({type,data,raw:bytes.subarray(offset,end)});offset=end;
    if(type==='IEND') {if(offset!==bytes.length)throw Error('Trailing data');break;}
  }
  if(chunks[0]?.type!=='IHDR'||chunks.at(-1)?.type!=='IEND'||chunks.some(c=>c.type==='acTL'))throw Error('Unsupported PNG');
  return chunks;
}
function packed(type,data) {
  const result=Buffer.alloc(data.length+12);result.writeUInt32BE(data.length);result.write(type,4,'ascii');data.copy(result,8);result.writeUInt32BE(crc(result.subarray(4,-4)),result.length-4);return result;
}
function prepareImage(bytes, optimize = true) {
  let output=bytes, identity=bytes;
  try {
    const chunks=parse(bytes), stream=inflateSync(Buffer.concat(chunks.filter(c=>c.type==='IDAT').map(c=>c.data)),{maxOutputLength:256*1024*1024});
    if (optimize) {
    const compressed=deflateSync(stream,{level:9});
    // Preserve all non-image chunks, including color profiles and transparency.
    // The exact filtered pixel stream remains unchanged; no decoding/requantizing.
    let inserted=false;const parts=[signature];
    for(const c of chunks) {if(c.type==='IDAT'){if(!inserted){parts.push(packed('IDAT',compressed));inserted=true;}}else parts.push(c.raw);}
    const candidate=Buffer.concat(parts);
    if(inserted&&candidate.length<bytes.length)output=candidate;
    }
    identity=Buffer.concat([signature,...chunks.filter(c=>c.type!=='IDAT').map(c=>c.raw),stream]);
  } catch { /* Keep unsupported or malformed files byte-for-byte. */ }
  return {bytes:output,hash:createHash('sha256').update(identity).digest('hex')};
}
const { Worker, isMainThread, parentPort }=require('node:worker_threads');
if(!isMainThread)parentPort.on('message',message=>{const result=prepareImage(Buffer.from(message.bytes),message.optimize);parentPort.postMessage(result);});
function prepareImageAsync(bytes, optimize = true){return new Promise((resolve,reject)=>{
 const worker=new Worker(__filename);let settled=false;
 const finish=result=>{if(settled)return;settled=true;clearTimeout(timer);worker.terminate();resolve(result);};
 const fallback=()=>finish({bytes,hash:createHash('sha256').update(bytes).digest('hex')});
 const timer=setTimeout(fallback,15000);
 worker.once('message',result=>finish({bytes:Buffer.from(result.bytes),hash:result.hash}));worker.once('error',fallback);worker.once('exit',fallback);worker.postMessage({bytes,optimize});
});}
const fingerprintCache = new Map();
async function rememberImageFingerprint(file, hash) {
 const fs=require('node:fs/promises'); const stat=await fs.stat(file);
 if(fingerprintCache.size>=2000)fingerprintCache.delete(fingerprintCache.keys().next().value);
 fingerprintCache.set(file,{stamp:`${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`,hash});
}
async function imageFingerprint(file) {
 const fs=require('node:fs/promises');
 const stat=await fs.stat(file), stamp= `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
 const cached=fingerprintCache.get(file);
 if(cached?.stamp===stamp)return cached.hash;
 const result=await prepareImageAsync(await fs.readFile(file),false);
 if(fingerprintCache.size>=2000)fingerprintCache.delete(fingerprintCache.keys().next().value);
 fingerprintCache.set(file,{stamp,hash:result.hash});
 return result.hash;
}
module.exports={prepareImage,prepareImageAsync,imageFingerprint,rememberImageFingerprint};
