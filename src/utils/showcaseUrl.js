const { resolveTikTokVideo, fetchTikTokThumbnail } = require('./tiktokUrl')
const { resolveInstagramPost, fetchInstagramThumbnail } = require('./instagramUrl')

async function resolveShowcaseClip(inputUrl) {
  const trimmed = String(inputUrl || '').trim()
  if (!trimmed) return null

  if (/instagram\.com/i.test(trimmed) || /instagr\.am/i.test(trimmed)) {
    return resolveInstagramPost(trimmed)
  }

  if (/tiktok\.com/i.test(trimmed) || /(?:vm|vt)\.tiktok\.com/i.test(trimmed)) {
    const resolved = await resolveTikTokVideo(trimmed)
    if (!resolved) return null
    return {
      source: 'tiktok',
      tiktok_url: resolved.tiktok_url,
      video_id: resolved.video_id,
    }
  }

  return null
}

async function fetchShowcaseThumbnail(source, mediaUrl) {
  if (source === 'instagram') return fetchInstagramThumbnail(mediaUrl)
  return fetchTikTokThumbnail(mediaUrl)
}

function showcaseReferer(source) {
  return source === 'instagram' ? 'https://www.instagram.com/' : 'https://www.tiktok.com/'
}

module.exports = {
  resolveShowcaseClip,
  fetchShowcaseThumbnail,
  showcaseReferer,
}
