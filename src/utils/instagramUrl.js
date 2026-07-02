const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

function extractInstagramShortcode(url) {
  const str = String(url || '')
  const patterns = [
    { type: 'reel', regex: /instagram\.com\/reel\/([A-Za-z0-9_-]+)/i },
    { type: 'p', regex: /instagram\.com\/p\/([A-Za-z0-9_-]+)/i },
    { type: 'tv', regex: /instagram\.com\/tv\/([A-Za-z0-9_-]+)/i },
    { type: 'p', regex: /instagr\.am\/p\/([A-Za-z0-9_-]+)/i },
  ]
  for (const { type, regex } of patterns) {
    const match = str.match(regex)
    if (match?.[1]) return { shortcode: match[1], type }
  }
  return null
}

function canonicalInstagramUrl(shortcode, type) {
  if (type === 'reel') return `https://www.instagram.com/reel/${shortcode}/`
  if (type === 'tv') return `https://www.instagram.com/tv/${shortcode}/`
  return `https://www.instagram.com/p/${shortcode}/`
}

async function resolveInstagramPost(inputUrl) {
  const trimmed = String(inputUrl || '').trim()
  if (!trimmed) return null
  if (!/instagram\.com/i.test(trimmed) && !/instagr\.am/i.test(trimmed)) {
    return null
  }

  let pageUrl = trimmed.split('?')[0].split('#')[0]
  let parsed = extractInstagramShortcode(pageUrl)

  if (!parsed) {
    try {
      const response = await fetch(trimmed, {
        redirect: 'follow',
        headers: { 'User-Agent': BROWSER_UA },
      })
      pageUrl = response.url.split('?')[0].split('#')[0]
      parsed = extractInstagramShortcode(pageUrl)
    } catch {
      return null
    }
  }

  if (!parsed) return null

  return {
    source: 'instagram',
    tiktok_url: canonicalInstagramUrl(parsed.shortcode, parsed.type),
    video_id: parsed.shortcode,
  }
}

function decodeOgImage(value) {
  return String(value || '')
    .replace(/\\u002F/g, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
}

async function fetchInstagramThumbnailFromOembed(instagramUrl) {
  try {
    const response = await fetch(
      `https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent(instagramUrl)}`,
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

async function fetchInstagramThumbnailFromOg(instagramUrl) {
  try {
    const response = await fetch(instagramUrl, {
      redirect: 'follow',
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept-Language': 'en-US,en;q=0.9,th;q=0.8',
        Accept: 'text/html,application/xhtml+xml',
      },
    })
    if (!response.ok) return null
    const html = await response.text()
    const patterns = [
      /property="og:image"\s+content="([^"]+)"/i,
      /content="([^"]+)"\s+property="og:image"/i,
    ]
    for (const pattern of patterns) {
      const match = html.match(pattern)
      if (match?.[1]) {
        const url = decodeOgImage(match[1])
        if (url.startsWith('http')) return url
      }
    }
    return null
  } catch {
    return null
  }
}

async function fetchInstagramThumbnail(instagramUrl) {
  const fromOembed = await fetchInstagramThumbnailFromOembed(instagramUrl)
  if (fromOembed) return fromOembed
  return fetchInstagramThumbnailFromOg(instagramUrl)
}

module.exports = {
  extractInstagramShortcode,
  resolveInstagramPost,
  fetchInstagramThumbnail,
}
