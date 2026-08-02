const { getPool } = require('../db/pool')

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

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
      `SELECT id, slug, name, is_active FROM shops WHERE slug = $1 LIMIT 1`,
      [slug]
    )
    const shop = result.rows[0]
    if (!shop) {
      return res.status(404).json({ error: 'ไม่พบร้าน' })
    }
    if (!shop.is_active) {
      return res.status(403).json({ error: 'ร้านนี้ปิดให้บริการชั่วคราว' })
    }
    req.shop = shop
    next()
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

module.exports = resolveShop
