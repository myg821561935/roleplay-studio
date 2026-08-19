// V3 角色卡 assets 的展示层安全消费：
// 只放行 http(s) 外链与同源相对路径；data:/javascript:/file: 等一律拒绝。
// 外链渲染时统一走 /api/proxy-image 服务端代理（含 SSRF 校验与重定向阻断）。
const ASSET_TYPE_LABELS = {
  image: '图片',
  icon: '图标',
  background: '背景',
  ambient: '环境音',
  music: '音乐',
  voice: '语音'
};
const EXTERNAL_ASSET_URI_PATTERN = /^https?:\/\/\S+$/i;
const RELATIVE_ASSET_URI_PATTERN = /^\/(?!\/)\S+$/;
const PREVIEWABLE_ASSET_TYPES = /^(image|icon|background)$/i;
const MAX_RENDERED_ASSETS = 24;

export function getCardAssetLabel(type) {
  return ASSET_TYPE_LABELS[String(type || '').trim().toLowerCase()] || String(type || '素材').trim() || '素材';
}

export function getCardAssetPreviewUrl(asset) {
  const uri = String(asset?.uri || '').trim();
  if (!uri) return '';
  if (EXTERNAL_ASSET_URI_PATTERN.test(uri)) {
    return `/api/proxy-image?url=${encodeURIComponent(uri)}`;
  }
  if (RELATIVE_ASSET_URI_PATTERN.test(uri)) return uri;
  return '';
}

export function isCardAssetPreviewable(asset) {
  return Boolean(getCardAssetPreviewUrl(asset)) && PREVIEWABLE_ASSET_TYPES.test(String(asset?.type || '').trim());
}

export function normalizeCardAssets(assets) {
  if (!Array.isArray(assets)) return [];
  return assets
    .filter((asset) => asset && typeof asset === 'object')
    .map((asset) => ({
      type: String(asset.type || 'unknown'),
      name: String(asset.name || ''),
      ext: String(asset.ext || ''),
      uri: String(asset.uri || '')
    }))
    .filter((asset) => asset.name && asset.uri)
    .slice(0, MAX_RENDERED_ASSETS);
}
