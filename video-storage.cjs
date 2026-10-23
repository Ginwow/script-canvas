const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov'];
async function storeVideo(base, bytes, extension) {
  extension = extension.toLowerCase();
  if (!VIDEO_EXTENSIONS.includes(extension) || !bytes.length || bytes.length > 100 * 1024 * 1024) throw new Error('视频支持 MP4、WebM、MOV，文件必须小于 100 MB');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const directory = path.join(base, 'assets', 'videos');
  await fs.mkdir(directory, { recursive: true });
  // The content determines identity, even if the same video was given another extension.
  const existing = (await fs.readdir(directory)).find(name => VIDEO_EXTENSIONS.some(ext => name === hash + ext));
  const name = existing || hash + extension;
  if (!existing) try { await fs.writeFile(path.join(directory, name), bytes, { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  return 'assets/videos/' + name;
}
module.exports = { storeVideo };
