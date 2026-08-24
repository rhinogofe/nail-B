function hasHttpUrl(value) {
  return /^https?:\/\//i.test(String(value ?? '').trim())
}

function isGoogleMapsEmbedUrl(value) {
  const url = String(value ?? '').trim()
  if (!hasHttpUrl(url)) return false
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    return (
      (host === 'google.com' || host.endsWith('.google.com'))
      && u.pathname.startsWith('/maps/embed')
    )
  } catch {
    return false
  }
}

function isShortGoogleMapsUrl(value) {
  const url = String(value ?? '').trim()
  if (!hasHttpUrl(url)) return false
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    return host === 'goo.gl' || host === 'g.co' || host === 'maps.app.goo.gl'
  } catch {
    return false
  }
}

function extractPbParam(url) {
  const raw = String(url ?? '').trim()
  if (!raw) return ''

  if (isGoogleMapsEmbedUrl(raw)) {
    try {
      return new URL(raw).searchParams.get('pb') || ''
    } catch {
      return ''
    }
  }

  try {
    const pb = new URL(raw).searchParams.get('pb')
    if (pb) return pb
  } catch {
    // fall through
  }

  const match = raw.match(/[?&]pb=([^&]+)/)
  return match?.[1] ? decodeURIComponent(match[1]) : ''
}

function buildEmbedFromPb(pb) {
  const value = String(pb ?? '').trim()
  if (!value) return ''
  return `https://www.google.com/maps/embed?pb=${encodeURIComponent(value)}`
}

function parseCoordinatePair(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const match = raw.match(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/)
  if (!match) return null
  return { lat: match[1], lng: match[2] }
}

function parseGoogleMapsLocation(url) {
  const raw = String(url ?? '').trim()
  if (!raw) return null

  const pinMatch = raw.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/)
  if (pinMatch) {
    return { lat: pinMatch[1], lng: pinMatch[2] }
  }

  const atMatch = raw.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/)
  if (atMatch) {
    return { lat: atMatch[1], lng: atMatch[2] }
  }

  try {
    const u = new URL(raw)
    const searchPathMatch = u.pathname.match(/\/maps\/search\/(-?\d+(?:\.\d+)?),\+?(-?\d+(?:\.\d+)?)/)
    if (searchPathMatch) {
      return { lat: searchPathMatch[1], lng: searchPathMatch[2] }
    }
    const q = u.searchParams.get('q') || u.searchParams.get('query')
    if (q) {
      const coords = parseCoordinatePair(q)
      if (coords) return coords
      return { query: q }
    }

    const ll = u.searchParams.get('ll')
    if (ll) {
      const coords = parseCoordinatePair(ll)
      if (coords) return coords
    }

    const placeId = u.searchParams.get('place_id')
    if (placeId) return { placeId }
  } catch {
    // fall through
  }

  const placeMatch = raw.match(/(ChIJ[\w-]+)/)
  if (placeMatch) return { placeId: placeMatch[1] }

  return null
}

function buildEmbedFromLocation(location, apiKey = '') {
  if (!location) return ''

  const key = String(apiKey ?? '').trim()
  if (key) {
    let q = ''
    if (location.placeId) q = `place_id:${location.placeId}`
    else if (location.lat && location.lng) q = `${location.lat},${location.lng}`
    else if (location.query) q = location.query
    if (q) {
      return `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}&language=th`
    }
  }

  if (location.lat && location.lng) {
    const q = `${location.lat},${location.lng}`
    return `https://www.google.com/maps?q=${encodeURIComponent(q)}&hl=th&z=16&output=embed`
  }
  if (location.query) {
    return `https://www.google.com/maps?q=${encodeURIComponent(location.query)}&hl=th&z=16&output=embed`
  }
  if (location.placeId) {
    return `https://www.google.com/maps?q=${encodeURIComponent(`place_id:${location.placeId}`)}&hl=th&z=16&output=embed`
  }

  return ''
}

function resolveShopMapEmbedUrlSync(mapUrl, embedUrl, options = {}) {
  const apiKey = options.apiKey ?? process.env.GOOGLE_MAPS_EMBED_API_KEY ?? ''

  const embed = String(embedUrl ?? '').trim()
  if (isGoogleMapsEmbedUrl(embed)) return embed

  const embedPb = extractPbParam(embed)
  if (embedPb) return buildEmbedFromPb(embedPb)

  const map = String(mapUrl ?? '').trim()
  if (!hasHttpUrl(map)) return ''
  if (isGoogleMapsEmbedUrl(map)) return map

  const mapPb = extractPbParam(map)
  if (mapPb) return buildEmbedFromPb(mapPb)

  const location = parseGoogleMapsLocation(map)
  return buildEmbedFromLocation(location, apiKey)
}

function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer))
}

const RESOLVE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7',
}

async function resolveGoogleMapsShareUrl(url) {
  const raw = String(url ?? '').trim()
  if (!raw || !isShortGoogleMapsUrl(raw)) return raw

  let current = raw
  for (let hop = 0; hop < 8; hop += 1) {
    try {
      const res = await fetchWithTimeout(current, {
        method: 'GET',
        redirect: 'manual',
        headers: RESOLVE_HEADERS,
      })

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location')
        if (!location) break
        current = new URL(location, current).href
        if (!isShortGoogleMapsUrl(current)) return current
        continue
      }

      if (res.url && !isShortGoogleMapsUrl(res.url)) return res.url
      if (!isShortGoogleMapsUrl(current)) return current
      break
    } catch (err) {
      console.warn('[googleMapEmbed] manual redirect failed:', err.message)
      break
    }
  }

  try {
    const res = await fetchWithTimeout(raw, {
      method: 'GET',
      redirect: 'follow',
      headers: RESOLVE_HEADERS,
    })
    if (res.url && !isShortGoogleMapsUrl(res.url)) return res.url
  } catch (err) {
    console.warn('[googleMapEmbed] follow redirect failed:', err.message)
  }

  return current
}

async function resolveShopMapEmbedUrl(mapUrl, embedUrl, options = {}) {
  let map = String(mapUrl ?? '').trim()

  if (hasHttpUrl(map)) {
    if (isShortGoogleMapsUrl(map)) {
      map = await resolveGoogleMapsShareUrl(map)
    }
    const fromMap = resolveShopMapEmbedUrlSync(map, '', options)
    if (fromMap) return fromMap
  }

  const embed = String(embedUrl ?? '').trim()
  if (isGoogleMapsEmbedUrl(embed)) return embed

  const embedPb = extractPbParam(embed)
  if (embedPb) return buildEmbedFromPb(embedPb)

  return ''
}

module.exports = {
  hasHttpUrl,
  isGoogleMapsEmbedUrl,
  isShortGoogleMapsUrl,
  extractPbParam,
  parseGoogleMapsLocation,
  buildEmbedFromLocation,
  resolveGoogleMapsShareUrl,
  resolveShopMapEmbedUrlSync,
  resolveShopMapEmbedUrl,
}
