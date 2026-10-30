const SLUG_RE = /^[\p{L}\p{M}\p{N}]+(?:-[\p{L}\p{M}\p{N}]+)*$/u
const MAX_SLUG_LENGTH = 80
const RESERVED_SHOP_SLUGS = new Set([
  'default',
  'api',
  'assets',
  'manifest',
  'bookings',
  'login',
  'admin',
  'register-shop',
  'reviews',
  'profile',
  'chat',
  'location',
  'payment',
  'booking-site',
  'shops',
  'presets',
  'auth',
  'icons',
  'favicon',
])

function normalizeShopSlugParam(raw) {
  const value = String(raw || '').trim()
  if (!value) return ''
  try {
    return decodeURIComponent(value).toLowerCase()
  } catch {
    return value.toLowerCase()
  }
}

function slugifyShopName(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{M}\p{N}-]+/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '')
}

function isShopSlugFormat(slug) {
  const s = String(slug || '').trim()
  if (!s || s.length > MAX_SLUG_LENGTH) return false
  return SLUG_RE.test(s)
}

function isCreatableShopSlug(slug) {
  const s = String(slug || '').trim()
  if (!isShopSlugFormat(s)) return false
  return !RESERVED_SHOP_SLUGS.has(s.toLowerCase())
}

function encodeShopSlugHeader(slug) {
  const s = String(slug || '').trim()
  if (!s) return ''
  return encodeURIComponent(s)
}

module.exports = {
  SLUG_RE,
  MAX_SLUG_LENGTH,
  RESERVED_SHOP_SLUGS,
  normalizeShopSlugParam,
  slugifyShopName,
  isShopSlugFormat,
  isCreatableShopSlug,
  encodeShopSlugHeader,
}
