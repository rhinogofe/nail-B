function extractTikTokMediaId(url) {
  const str = String(url || '')
  const videoMatch = str.match(/\/video\/(\d+)/)
  if (videoMatch) return videoMatch[1]
  const photoMatch = str.match(/\/photo\/(\d+)/)
  if (photoMatch) return photoMatch[1]
  return null
}

function extractTikTokVideoId(url) {
  return extractTikTokMediaId(url)
}

function normalizeTikTokPageUrl(url) {
  const trimmed = String(url || '').trim()
  if (!trimmed) return ''
  try {
    const parsed = new URL(trimmed)
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return trimmed.split('?')[0].split('#')[0]
  }
}

async function resolveTikTokVideo(inputUrl) {
  const trimmed = String(inputUrl || '').trim()
  if (!trimmed) return null

  if (!/tiktok\.com/i.test(trimmed)) {
    return null
  }

  let pageUrl = normalizeTikTokPageUrl(trimmed)
  let mediaId = extractTikTokMediaId(pageUrl)

  if (!mediaId && /(?:vm|vt)\.tiktok\.com/i.test(trimmed)) {
    try {
      const response = await fetch(trimmed, {
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; NailBooking/1.0)',
        },
      })
      pageUrl = normalizeTikTokPageUrl(response.url)
      mediaId = extractTikTokMediaId(pageUrl)
    } catch {
      return null
    }
  }

  if (!mediaId) return null

  const isPhoto = /\/photo\//.test(pageUrl)
  const tiktok_url = isPhoto
    ? pageUrl
    : pageUrl.includes('/video/')
      ? pageUrl
      : `https://www.tiktok.com/video/${mediaId}`

  return {
    video_id: mediaId,
    tiktok_url,
  }
}

module.exports = {
  extractTikTokVideoId,
  extractTikTokMediaId,
  normalizeTikTokPageUrl,
  resolveTikTokVideo,
}
