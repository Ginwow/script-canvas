const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

const AUDIO_EXTENSIONS = ['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.flac', '.webm'];
// Preserve WebM's audio meaning in immutable undo copies as well.
function isAudioAssetPath(assetPath) {
  if (typeof assetPath !== 'string') return false;
  const normalized = assetPath.replace(/\\/g, '/');
  const extension = path.extname(normalized).toLowerCase();
  return AUDIO_EXTENSIONS.includes(extension) && (extension !== '.webm' || /^assets\/(?:\.undo\/)?audio\//i.test(normalized));
}
async function storeAudio(base, bytes, extension) {
  extension = extension.toLowerCase();
  if (!AUDIO_EXTENSIONS.includes(extension) || !bytes.length || bytes.length > 100 * 1024 * 1024) throw new Error('音频支持 WAV、MP3、M4A、AAC、OGG、FLAC、WebM，文件必须小于 100 MB');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const directory = path.join(base, 'assets', 'audio');
  await fs.mkdir(directory, { recursive: true });
  const existing = (await fs.readdir(directory)).find(name => AUDIO_EXTENSIONS.some(ext => name === hash + ext));
  const name = existing || hash + extension;
  if (!existing) try { await fs.writeFile(path.join(directory, name), bytes, { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  return 'assets/audio/' + name;
}
module.exports = { AUDIO_EXTENSIONS, isAudioAssetPath, storeAudio };
