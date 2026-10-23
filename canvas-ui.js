/* Shared synchronous presentation helpers; no observers or persisted state. */
(() => {
  'use strict';
  const paths = {
    script: '<path d="M6 3h9l3 3v15H6zM14 3v5h4M9 12h6M9 16h6"/>',
    text: '<path d="M5 6h14M5 10h14M5 14h10M5 18h8"/>',
    prompt: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16"/>',
    plot: '<path d="M5 5h14v14H5zM8 9h8M8 12h8M8 15h5"/>',
    style: '<path d="m15 3 6 6-10 10-7 1 1-7zM13 5l6 6M5 13l6 6"/>',
    person: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5"/>',
    character: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    'shot-group': '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 10h18M7 5l3 5m3-5 3 5M7 2h10"/>',
    shot: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 10h18M7 5l3 5m3-5 3 5"/>',
    storyboard: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M10 10v10M16 10v10"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
    video: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m10 8 6 4-6 4z"/>',
    audio: '<path d="M9 18V5l11-2v13M9 9l11-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="17" cy="16" rx="3" ry="3"/>',
    asset: '<path d="M4 7h6l2-3h8v16H4z"/>',
  };
  paths['cover-group'] = paths.image;
  paths['video-group'] = paths.video;
  paths['bgm-group'] = paths.audio;
  function iconKind(value) {
    const data = typeof value === 'string' ? {kind: value} : value?.dataset || value || {};
    if (data.kind !== 'asset') return data.kind || 'text';
    const name = String(data.assetPath || data.fileName || data.name || '').replace(/\\/g, '/').split(/[?#]/)[0];
    if (/\.(wav|mp3|m4a|aac|ogg|flac)$/i.test(name) || /(?:^|\/)audio\/.*\.webm$/i.test(name) || value?.classList?.contains('audio-card')) return 'audio';
    if (/\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(name) || value?.querySelector?.('.asset-preview video')) return 'video';
    if (/\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(name) || data.imageRole || value?.querySelector?.('.asset-preview img')) return 'image';
    return 'asset';
  }
  window.canvasNodeIcon = value => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[iconKind(value)] || paths.text}</svg>`;
  window.setCanvasNodeIcon = node => {
    const icon = node?.querySelector?.('.node-icon');
    if (icon) icon.innerHTML = window.canvasNodeIcon(node);
  };
})();
