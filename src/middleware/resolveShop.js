const { getPool } = require('../db/pool')
const { isShopUsageExpired, enrichShopUsage } = require('../utils/shopUsageLimit')

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const SHOP_SELECT = `
  id, slug, name, is_active, created_at, usage_limit_days, usage_started_at
`

function isAdminApiRequest(req) {
  return String(req.originalUrl || req.url || '').startsWith('/api/admin')
}

async function resolveShop(req, res, next) {
  const slug = String(
    req.headers['x-shop-slug']
    || req.params.shopSlug
    || req.query.shop
    || ''
  ).trim().toLowerCase()

  if (!slug || !SLUG_RE.test(slug)) {
    return res.status(400).json({ error: 'ต้องระบุร้าน (X-Shop-Slug)' })
  }

  try {
    const pool = getPool()
    const result = await pool.query(
      `SELECT ${SHOP_SELECT} FROM shops WHERE slug = $1 LIMIT 1`,
      [slug]
    )
    const shop = enrichShopUsage(result.rows[0])
    if (!shop) {
      return res.status(404).json({ error: 'ไม่พบร้าน' })
    }
    if (!shop.is_active) {
      return res.status(403).json({ error: 'ร้านนี้ปิดให้บริการชั่วคราว' })
    }
    if (shop.usage_expired && !isAdminApiRequest(req)) {
      return res.status(403).json({
        error: 'สาขานี้หมดระยะเวลาใช้งานแล้ว กรุณาติดต่อผู้ดูแลระบบ',
        code: 'SHOP_USAGE_EXPIRED',
        usage_expires_at: shop.usage_expires_at,
        usage_days_remaining: 0,
      })
    }
    req.shop = shop
    next()
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

module.exports = resolveShop
module.exports.SHOP_SELECT = SHOP_SELECT
module.exports.enrichShopUsage = enrichShopUsage
module.exports.isShopUsageExpired = isShopUsageExpired
