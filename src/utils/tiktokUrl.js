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

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
// TikTok only renders og:image for link-preview crawlers; browsers get the SPA payload instead.
const PREVIEW_BOT_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'

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
          'User-Agent': BROWSER_UA,
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

function decodeOgImage(value) {
  return String(value || '')
    .replace(/\\u002F/gi, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
}

const COVER_PATTERNS = [
  /property="og:image"\s+content="([^"]+)"/i,
  /content="([^"]+)"\s+property="og:image"/i,
  /"cover":"(https?:[^"]+)"/,
  /"originCover":"(https?:[^"]+)"/,
  /"imageURL":\{"urlList":\["(https?:[^"]+)"/,
]

function extractTikTokCoverFromHtml(html) {
  const text = String(html || '')
  for (const pattern of COVER_PATTERNS) {
    const match = text.match(pattern)
    if (!match?.[1]) continue
    const url = decodeOgImage(match[1])
    if (/^https?:\/\//.test(url)) return url
  }
  return null
}

async function fetchTikTokThumbnailFromOembed(tiktokUrl) {
  try {
    const response = await fetch(
      `https://www.tiktok.com/oembed?url=${encodeURIComponent(tiktokUrl)}`,
      {
        headers: {
          'User-Agent': BROWSER_UA,
          Accept: 'application/json',
        },
      }
    )
    if (!response.ok) return null
    const data = await response.json()
    return data.thumbnail_url || null
  } catch {
    return null
  }
}

async function fetchTikTokThumbnailFromOg(tiktokUrl, userAgent = BROWSER_UA) {
  try {
    const response = await fetch(tiktokUrl, {
      redirect: 'follow',
      headers: {
        'User-Agent': userAgent,
        'Accept-Language': 'en-US,en;q=0.9,th;q=0.8',
        Accept: 'text/html,application/xhtml+xml',
      },
    })
    if (!response.ok) return null
    return extractTikTokCoverFromHtml(await response.text())
  } catch {
    return null
  }
}

function oembedUrlForThumbnail(tiktokUrl) {
  const mediaId = extractTikTokMediaId(tiktokUrl)
  if (!mediaId) return [tiktokUrl]
  const videoUrl = `https://www.tiktok.com/video/${mediaId}`
  if (tiktokUrl.includes('/photo/') || !tiktokUrl.includes('/video/')) {
    return [videoUrl, tiktokUrl]
  }
  return [tiktokUrl, videoUrl]
}

async function fetchTikTokThumbnail(tiktokUrl) {
  const candidates = oembedUrlForThumbnail(tiktokUrl)
  for (const url of candidates) {
    const fromOembed = await fetchTikTokThumbnailFromOembed(url)
    if (fromOembed) return fromOembed
  }
  for (const userAgent of [PREVIEW_BOT_UA, BROWSER_UA]) {
    for (const url of candidates) {
      const fromPage = await fetchTikTokThumbnailFromOg(url, userAgent)
      if (fromPage) return fromPage
    }
  }
  return null
}

module.exports = {
  extractTikTokVideoId,
  extractTikTokMediaId,
  normalizeTikTokPageUrl,
  resolveTikTokVideo,
  fetchTikTokThumbnail,
  extractTikTokCoverFromHtml,
}
