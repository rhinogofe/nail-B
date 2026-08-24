const router = require('express').Router()
const { getPool } = require('../db/pool')
const {
  SHOP_FEATURE_CATALOG,
  getShopFeatureFlags,
  setShopFeatureFlags,
  getNewShopDefaultTemplate,
  setNewShopDefaultTemplate,
} = require('../utils/shopFeatureFlags')

function requireSuperAdminDefault(req, res) {
  if (!req.isSuperAdmin || req.shop.slug !== 'default') {
    res.status(403).json({ error: 'เฉพาะแอดมินหลัก (default) เท่านั้น' })
    return false
  }
  return true
}

router.get('/catalog', (req, res) => {
  if (!requireSuperAdminDefault(req, res)) return
  res.json({ groups: SHOP_FEATURE_CATALOG })
})

router.get('/defaults', async (req, res) => {
  if (!requireSuperAdminDefault(req, res)) return
  try {
    const pool = getPool()
    const features = await getNewShopDefaultTemplate(pool)
    res.json({ features })
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
})

router.patch('/defaults', async (req, res) => {
  if (!requireSuperAdminDefault(req, res)) return
  const partial = req.body?.features
  if (!partial || typeof partial !== 'object') {
    return res.status(400).json({ error: 'ต้องระบุ features (object)' })
  }
  try {
    const pool = getPool()
    const features = await setNewShopDefaultTemplate(pool, partial)
    res.json({ success: true, features })
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
})

router.get('/shops', async (req, res) => {
  if (!requireSuperAdminDefault(req, res)) return
  try {
    const pool = getPool()
    const result = await pool.query(
      `SELECT id, slug, name, is_active
       FROM shops
       WHERE slug <> 'default'
       ORDER BY is_active DESC, name ASC`
    )
    const shops = []
    for (const row of result.rows) {
      const { features } = await getShopFeatureFlags(pool, row.id)
      shops.push({
        id: row.id,
        slug: row.slug,
        name: row.name,
        is_active: row.is_active,
        features,
      })
    }
    res.json({ shops })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/:slug', async (req, res) => {
  if (!requireSuperAdminDefault(req, res)) return
  const slug = String(req.params.slug || '').trim().toLowerCase()
  if (!slug || slug === 'default') {
    return res.status(400).json({ error: 'slug ไม่ถูกต้อง' })
  }
  try {
    const pool = getPool()
    const existing = await pool.query(
      `SELECT id, slug, name, is_active FROM shops WHERE slug = $1 LIMIT 1`,
      [slug]
    )
    const shop = existing.rows[0]
    if (!shop) return res.status(404).json({ error: 'ไม่พบสาขา' })
    const { features, overrides } = await getShopFeatureFlags(pool, shop.id)
    res.json({
      id: shop.id,
      slug: shop.slug,
      name: shop.name,
      is_active: shop.is_active,
      features,
      overrides,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.patch('/:slug', async (req, res) => {
  if (!requireSuperAdminDefault(req, res)) return
  const slug = String(req.params.slug || '').trim().toLowerCase()
  if (!slug || slug === 'default') {
    return res.status(400).json({ error: 'slug ไม่ถูกต้อง' })
  }
  const partial = req.body?.features
  if (!partial || typeof partial !== 'object') {
    return res.status(400).json({ error: 'ต้องระบุ features (object)' })
  }
  try {
    const pool = getPool()
    const existing = await pool.query(
      `SELECT id, slug, name, is_active FROM shops WHERE slug = $1 LIMIT 1`,
      [slug]
    )
    const shop = existing.rows[0]
    if (!shop) return res.status(404).json({ error: 'ไม่พบสาขา' })

    const { features, overrides } = await setShopFeatureFlags(pool, shop.id, partial)
    res.json({
      success: true,
      id: shop.id,
      slug: shop.slug,
      name: shop.name,
      is_active: shop.is_active,
      features,
      overrides,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
