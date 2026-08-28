const sharp = require('sharp')
const { parseStoredUiImagePath, readUiImageFile } = require('./shopUiImages')

const ICON_SIZES = new Set([32, 180, 192, 512])
const FETCH_TIMEOUT_MS = 10000
const memoryCache = new Map()
const CACHE_MAX_ENTRIES = 100

function logoIconVersion(logoUrl) {
  const logo = String(logoUrl || '').trim()
  if (!logo) return '0'
  const parsed = parseStoredUiImagePath(logo)
  if (parsed?.filename) {
    return parsed.filename.replace(/\.[^.]+$/, '').slice(0, 12)
  }
  let hash = 5381
  for (let i = 0; i < logo.length; i += 1) {
    hash = (hash * 33) ^ logo.charCodeAt(i)
  }
  return (hash >>> 0).toString(36)
}

function parseIconSize(raw) {
  const size = Number.parseInt(String(raw || ''), 10)
  return ICON_SIZES.has(size) ? size : null
}

function shopIconPublicUrl(apiBase, slug, size, version) {
  const base = String(apiBase || '').replace(/\/$/, '')
  const v = version != null && version !== '' ? `?v=${encodeURIComponent(String(version))}` : ''
  return `${base}/api/shops/${encodeURIComponent(slug)}/icon/${size}.png${v}`
}

async function fetchExternalLogo(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (!buf.length || buf.length > 5 * 1024 * 1024) return null
    return buf
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function loadLogoBuffer(shopId, ui) {
  const logo = String(ui?.ui_logo_url || '').trim()
  if (!logo) return null
  if (/^https?:\/\//i.test(logo)) {
    return fetchExternalLogo(logo)
  }
  const parsed = parseStoredUiImagePath(logo)
  if (parsed) {
    return readUiImageFile(shopId, parsed.kind, parsed.filename)
  }
  return null
}

function parseHexColor(color, fallback = '#C4847A') {
  const c = String(color || '').trim()
  if (/^#[0-9a-f]{6}$/i.test(c)) return c
  return fallback
}

function escapeSvgText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function renderFallbackIcon(shopName, primaryColor, size) {
  const letter = String(shopName || 'N').trim().charAt(0).toUpperCase() || 'N'
  const bg = parseHexColor(primaryColor)
  const fontSize = Math.round(size * 0.44)
  const safeLetter = escapeSvgText(letter)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${Math.round(size * 0.18)}" fill="${bg}"/>
    <text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" fill="#FFFFFF" font-family="Arial,sans-serif" font-weight="600" font-size="${fontSize}">${safeLetter}</text>
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

async function cropLogoToSquarePng(sourceBuffer, size) {
  return sharp(sourceBuffer, { animated: false })
    .rotate()
    .resize(size, size, { fit: 'cover', position: 'centre' })
    .png({ compressionLevel: 9 })
    .toBuffer()
}

function getCached(key) {
  return memoryCache.get(key) || null
}

function setCached(key, buffer) {
  if (memoryCache.size >= CACHE_MAX_ENTRIES) {
    const first = memoryCache.keys().next().value
    memoryCache.delete(first)
  }
  memoryCache.set(key, buffer)
}

async function renderShopIconPng({ shopId, shopName, ui, size }) {
  const version = logoIconVersion(ui?.ui_logo_url)
  const cacheKey = `${shopId}:${size}:${version}`
  const cached = getCached(cacheKey)
  if (cached) return cached

  const logoBuffer = await loadLogoBuffer(shopId, ui)
  let png
  if (logoBuffer) {
    try {
      png = await cropLogoToSquarePng(logoBuffer, size)
    } catch {
      png = await renderFallbackIcon(shopName, ui?.ui_color_primary, size)
    }
  } else {
    png = await renderFallbackIcon(shopName, ui?.ui_color_primary, size)
  }
  setCached(cacheKey, png)
  return png
}

function buildShopBranding(req, shop, ui) {
  const version = logoIconVersion(ui.ui_logo_url)
  const base = String(
    process.env.API_PUBLIC_URL || `${req.protocol}://${req.get('host')}`,
  ).replace(/\/$/, '')
  return {
    name: shop.name,
    slug: shop.slug,
    icon_version: version,
    icons: {
      favicon: shopIconPublicUrl(base, shop.slug, 32, version),
      apple: shopIconPublicUrl(base, shop.slug, 180, version),
      pwa192: shopIconPublicUrl(base, shop.slug, 192, version),
      pwa512: shopIconPublicUrl(base, shop.slug, 512, version),
    },
  }
}

module.exports = {
  ICON_SIZES,
  logoIconVersion,
  parseIconSize,
  shopIconPublicUrl,
  renderShopIconPng,
  buildShopBranding,
}
