const { getShopSetting, setShopSetting } = require('./shopSettings')
const DEFAULT_CONTENT = require('./bookingSiteDefaultContent.json')
const { resolveShopMapEmbedUrl } = require('./googleMapEmbed')

const CONTENT_KEY = 'booking_site_content'
const MAX_JSON_BYTES = 1_500_000

function cloneDefault() {
  return JSON.parse(JSON.stringify(DEFAULT_CONTENT))
}

function logoFromName(name) {
  const compact = String(name || '')
    .replace(/\s+/g, '')
    .toUpperCase()
    .slice(0, 18)
  return compact || 'NAIL'
}

function bookingPathForShop(shop) {
  const slug = String(shop?.slug || '').trim().toLowerCase()
  return slug ? `/${slug}/bookings` : '/bookings'
}

function buildDefaultContent(shop) {
  const content = cloneDefault()
  const name = String(shop?.name || '').trim() || 'ร้านเล็บ'
  content.site.name = name
  content.site.logoText = logoFromName(name)
  content.site.bookingUrl = bookingPathForShop(shop)
  return content
}

function isStockUnthemed(theme) {
  if (!theme || typeof theme !== 'object') return true
  const bg = String(theme.bg || '').trim().toLowerCase()
  const btn = String(theme.heroBtnBg || '').trim().toLowerCase()
  return bg === '#070605' && (btn === '#ffffff' || btn === '#fff' || btn === '')
}

const LAYOUT_VERSION = 2
const STOCK_ABOUT_TITLES = new Set([
  'ร้านที่ทำให้คุณอยากกลับมาอีก',
  'ร้านทำเล็บที่จองคิวได้จริง',
  'ตัดผมแบบไม่ต้องรอคิวหน้าร้าน',
  'ต่อขนตาแบบจองคิวล่วงหน้า',
  'ร้านคิ้วที่จองคิวได้ล่วงหน้า',
  'สปาที่จองคิวได้ ไม่ต้องรอ',
])
const LEGACY_ABOUT_LABELS = new Set(['เกี่ยวกับ', 'เกี่ยวกับร้าน', ''])
const NAV_ORDER = DEFAULT_CONTENT.nav.map((item) => item.section)

function hasLegacySectionOrder(nav, stockAbout) {
  const seq = nav
    .map((item) => item.section)
    .filter((s) => s === 'rooms' || s === 'promo' || s === 'news' || s === 'about')
    .join(',')
  if (seq === 'rooms,promo,news' || seq === 'rooms,promo,news,about') return true
  return stockAbout && seq === 'about,rooms,promo,news'
}

/** v2: ส่วน «เกี่ยวกับ» เปลี่ยนเป็น «ที่อยู่ร้าน» อยู่ท้ายสุด · ลำดับ บริการ → รีวิว → โปรโมชั่น → ที่อยู่ร้าน */
function migrateAddressLayout(next) {
  if (Number(next.layoutVersion) >= LAYOUT_VERSION) return
  const stockAbout = !next.about || STOCK_ABOUT_TITLES.has(String(next.about.title || '').trim())
  if (stockAbout) next.about = { ...cloneDefault().about }

  if (Array.isArray(next.nav)) {
    let nav = next.nav.map((item) => {
      if (item.section !== 'about') return item
      const label = LEGACY_ABOUT_LABELS.has(String(item.label || '').trim()) ? 'ที่อยู่ร้าน' : item.label
      return { ...item, label, show: stockAbout ? true : item.show }
    })
    if (hasLegacySectionOrder(nav, stockAbout)) {
      if (!nav.some((item) => item.section === 'about')) {
        nav.push({ section: 'about', label: 'ที่อยู่ร้าน', show: true })
      }
      const rank = (s) => {
        const i = NAV_ORDER.indexOf(s)
        return i === -1 ? NAV_ORDER.length : i
      }
      nav = nav
        .map((item, i) => ({ item, i }))
        .sort((a, b) => rank(a.item.section) - rank(b.item.section) || a.i - b.i)
        .map(({ item }) => item)
    }
    next.nav = nav
  }
  next.layoutVersion = LAYOUT_VERSION
}

function normalizeLegacyContent(content) {
  if (!content || typeof content !== 'object') return content
  const next = content

  if (Array.isArray(next.hero) && next.hero[0]?.tab === 'บริการ' && next.hero[1]?.tab === 'บรรยากาศ') {
    next.hero = next.hero.map((slide, i) => {
      if (i === 0) return { ...slide, tab: 'หน้าแรก' }
      if (i === 1) return { ...slide, tab: 'บริการ' }
      return slide
    })
  } else if (Array.isArray(next.hero)) {
    next.hero = next.hero.map((slide) => (
      slide?.tab === 'บรรยากาศ' ? { ...slide, tab: 'หน้าแรก' } : slide
    ))
  }

  if (Array.isArray(next.nav)) {
    const diningTitle = String(next.dining?.title || '').trim()
    const diningStock = !diningTitle || diningTitle === 'บรรยากาศที่จำได้นาน'
    next.nav = next.nav.map((item) => {
      if (item.section === 'dining' && diningStock) return { ...item, show: false }
      if (item.section === 'news' && (item.label === 'ข่าวสาร' || !item.label)) {
        return { ...item, label: 'รีวิว' }
      }
      return item
    })
    if (!next.nav.some((item) => item.section === 'top')) {
      next.nav = [{ section: 'top', label: 'หน้าแรก', show: true }, ...next.nav]
    }
  }

  migrateAddressLayout(next)
  if (next.newsHeading === 'ข่าวสารล่าสุด') next.newsHeading = 'รีวิว'
  if (isStockUnthemed(next.theme)) {
    next.theme = JSON.parse(JSON.stringify(cloneDefault().theme))
  }
  return next
}

function withBookingFallback(content, shop) {
  const next = content && typeof content === 'object' ? content : buildDefaultContent(shop)
  if (!next.site || typeof next.site !== 'object') next.site = {}
  if (!String(next.site.bookingUrl || '').trim()) {
    next.site.bookingUrl = bookingPathForShop(shop)
  }
  return next
}

function parseStoredContent(raw) {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    if (!parsed.site || !Array.isArray(parsed.hero) || !parsed.hero.length) return null
    return parsed
  } catch {
    return null
  }
}

function validateContent(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'ข้อมูลไม่ถูกต้อง' }
  }
  if (!body.site || typeof body.site !== 'object' || Array.isArray(body.site)) {
    return { error: 'ข้อมูลไม่ถูกต้อง' }
  }
  if (!Array.isArray(body.hero) || !body.hero.length) {
    return { error: 'ข้อมูลไม่ถูกต้อง' }
  }
  let json
  try {
    json = JSON.stringify(body)
  } catch {
    return { error: 'ข้อมูลไม่ถูกต้อง' }
  }
  if (json.length > MAX_JSON_BYTES) {
    return { error: 'ข้อมูลใหญ่เกินไป' }
  }
  return { content: JSON.parse(json) }
}

async function getBookingSiteContent(pool, shop) {
  const raw = await getShopSetting(pool, shop.id, CONTENT_KEY)
  const stored = parseStoredContent(raw)
  return normalizeLegacyContent(withBookingFallback(stored || buildDefaultContent(shop), shop))
}

async function resolveAboutMap(content) {
  const about = content.about
  if (!about || typeof about !== 'object') return
  const mapUrl = String(about.mapUrl || '').trim()
  about.mapUrl = mapUrl
  if (!/^https?:\/\//i.test(mapUrl)) {
    about.mapEmbedUrl = ''
    about.mapEmbedFor = ''
    return
  }
  if (about.mapEmbedFor === mapUrl && String(about.mapEmbedUrl || '').trim()) return
  try {
    about.mapEmbedUrl = (await resolveShopMapEmbedUrl(mapUrl, '')) || ''
  } catch {
    about.mapEmbedUrl = ''
  }
  about.mapEmbedFor = about.mapEmbedUrl ? mapUrl : ''
}

async function saveBookingSiteContent(pool, shop, body) {
  const checked = validateContent(body)
  if (checked.error) return checked
  const content = withBookingFallback(checked.content, shop)
  await resolveAboutMap(content)
  await setShopSetting(pool, shop.id, CONTENT_KEY, JSON.stringify(content))
  return { content }
}

module.exports = {
  CONTENT_KEY,
  MAX_JSON_BYTES,
  buildDefaultContent,
  bookingPathForShop,
  parseStoredContent,
  validateContent,
  withBookingFallback,
  normalizeLegacyContent,
  resolveAboutMap,
  getBookingSiteContent,
  saveBookingSiteContent,
}
