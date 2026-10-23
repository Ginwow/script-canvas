const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {isAudioAssetPath}=require('../audio-storage.cjs'),{prune}=require('../undo-assets.cjs');
test('WebM retains audio meaning in undo paths while video remains video',()=>{
 assert.equal(isAudioAssetPath('assets/audio/voice.webm'),true);
 assert.equal(isAudioAssetPath('assets/.undo/audio/voice.webm'),true);
 assert.equal(isAudioAssetPath('assets\\.undo\\audio\\voice.webm'),true);
 assert.equal(isAudioAssetPath('assets/videos/clip.webm'),false);
 assert.equal(isAudioAssetPath('assets/.undo/clip.webm'),false);
});
test('pruning retains current and history audio, removes stale and empty folders',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'canvas-audio-undo-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const folder=path.join(base,'assets/.undo/audio'),file=path.join(base,'project.json');await fs.mkdir(folder,{recursive:true});
 const refs=['a','b','c'].map(c=>'assets/.undo/audio/'+c.repeat(64)+'.webm');
 for(const ref of refs)await fs.writeFile(path.join(base,ref),'audio');
 await fs.writeFile(file,JSON.stringify({canvas:{nodes:[{assetPath:refs[0]}]}}));
 assert.equal(await prune(file,[refs[1]]),1);await fs.access(path.join(base,refs[0]));await fs.access(path.join(base,refs[1]));
 await fs.writeFile(file,'{}');assert.equal(await prune(file),2);await assert.rejects(fs.access(path.join(base,'assets/.undo')));
});
