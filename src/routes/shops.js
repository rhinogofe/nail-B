const router = require('express').Router()
const auth = require('../middleware/authMiddleware')
const admin = require('../middleware/adminMiddleware')
const { getPool } = require('../db/pool')
const { isSuperAdmin } = require('../utils/shopAdmins')
const { createShopRecord } = require('../utils/createShopRecord')
const { getUiSettings, UI_DEFAULTS } = require('../utils/shopUiSettings')
const { enrichShopUsage, parseUsageLimitDays } = require('../utils/shopUsageLimit')

const SHOP_RETURN = 'id, slug, name, is_active, created_at, usage_limit_days, usage_started_at'

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function frontendBaseUrl() {
  return String(process.env.FRONTEND_URL || '').split(',')[0].trim().replace(/\/$/, '')
}

function apiBaseUrl(req) {
  return String(process.env.API_PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')
}

function buildShareImage(req, slug, ui) {
  const logo = String(ui.ui_logo_url || '').trim()
  if (!logo) return ''
  if (/^https?:\/\//i.test(logo)) return logo
  const path = logo.startsWith('/') ? logo : `/${logo}`
  return `${apiBaseUrl(req)}${path}?shop=${encodeURIComponent(slug)}`
}

async function requireSuperAdminUser(req, res, next) {
  try {
    const pool = getPool()
    const ok = await isSuperAdmin(pool, req.user.id)
    if (!ok) {
      return res.status(403).json({ error: 'เฉพาะแอดมินหลัก (default) เท่านั้นที่จัดการสาขาได้' })
    }
    next()
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

router.get('/', async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.query(
      `SELECT ${SHOP_RETURN}
       FROM shops
       WHERE is_active = true
       ORDER BY name ASC`
    )
    const shops = result.rows
      .map(enrichShopUsage)
      .filter((shop) => !shop.usage_expired)
    res.json(shops)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/:slug/share-preview', async (req, res) => {
  const slug = req.params.slug.toLowerCase()
  if (!SLUG_RE.test(slug)) {
    return res.status(400).json({ error: 'slug ไม่ถูกต้อง' })
  }

  try {
    const pool = getPool()
    const result = await pool.query(
      `SELECT id, slug, name, is_active FROM shops WHERE slug = $1 LIMIT 1`,
      [slug]
    )
    const shop = result.rows[0]
    if (!shop || !shop.is_active) {
      return res.status(404).json({ error: 'ไม่พบร้าน' })
    }

    const ui = await getUiSettings(pool, shop.id)
    const pageTitle = String(ui.ui_page_title || '').trim()
    const title = pageTitle && pageTitle !== UI_DEFAULTS.ui_page_title ? pageTitle : shop.name
    const description = String(ui.ui_tagline || '').trim() || `จองคิว ${shop.name}`
    const image = buildShareImage(req, slug, ui)
    const siteBase = frontendBaseUrl()
    const url = siteBase ? `${siteBase}/${slug}/bookings` : `/${slug}/bookings`

    res.set('Cache-Control', 'public, max-age=300')
    res.json({ title, description, image, url })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/:slug', async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.query(
      `SELECT ${SHOP_RETURN}
       FROM shops
       WHERE slug = $1 AND is_active = true
       LIMIT 1`,
      [req.params.slug.toLowerCase()]
    )
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'ไม่พบร้าน' })
    }
    res.json(enrichShopUsage(result.rows[0]))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/', auth, admin, requireSuperAdminUser, async (req, res) => {
  const name = String(req.body?.name || '').trim()
  const slug = String(req.body?.slug || '').trim().toLowerCase()

  if (!name) return res.status(400).json({ error: 'ต้องระบุชื่อร้าน' })
  if (!slug || !SLUG_RE.test(slug)) {
    return res.status(400).json({ error: 'slug ใช้ได้เฉพาะ a-z, 0-9 และ -' })
  }

  const usageLimitDays = parseUsageLimitDays(req.body?.usage_limit_days)

  try {
    const pool = getPool()
    const client = await pool.connect()
    let shop
    try {
      await client.query('BEGIN')
      shop = await createShopRecord(client, { slug, name, usageLimitDays })
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
    res.status(201).json({ success: true, shop: enrichShopUsage(shop) })
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'slug นี้ถูกใช้แล้ว' })
    }
    res.status(500).json({ error: err.message })
  }
})

router.patch('/:slug', auth, admin, requireSuperAdminUser, async (req, res) => {
  const slug = req.params.slug.toLowerCase()
  const name = req.body?.name != null ? String(req.body.name).trim() : null
  const isActive = req.body?.is_active
  const hasUsageLimit = Object.prototype.hasOwnProperty.call(req.body || {}, 'usage_limit_days')
  const usageLimitDays = hasUsageLimit ? parseUsageLimitDays(req.body.usage_limit_days) : undefined
  const resetUsagePeriod = req.body?.reset_usage_period === true

  if (name === '') return res.status(400).json({ error: 'ชื่อร้านไม่ถูกต้อง' })

  try {
    const pool = getPool()
    const fields = []
    const params = []

    if (name) {
      params.push(name)
      fields.push(`name = $${params.length}`)
    }
    if (typeof isActive === 'boolean') {
      params.push(isActive)
      fields.push(`is_active = $${params.length}`)
    }
    if (hasUsageLimit) {
      params.push(usageLimitDays)
      fields.push(`usage_limit_days = $${params.length}`)
      if (usageLimitDays != null) {
        fields.push('usage_started_at = NOW()')
      } else {
        fields.push('usage_started_at = NULL')
      }
    } else if (resetUsagePeriod) {
      fields.push('usage_started_at = NOW()')
    }
    if (!fields.length) {
      return res.status(400).json({ error: 'ไม่มีข้อมูลให้แก้ไข' })
    }

    params.push(slug)
    const result = await pool.query(
      `UPDATE shops SET ${fields.join(', ')}
       WHERE slug = $${params.length}
       RETURNING ${SHOP_RETURN}`,
      params
    )
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'ไม่พบร้าน' })
    }
    res.json({ success: true, shop: enrichShopUsage(result.rows[0]) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/:slug', auth, admin, requireSuperAdminUser, async (req, res) => {
  const slug = req.params.slug.toLowerCase()
  if (slug === 'default') {
    return res.status(400).json({ error: 'ไม่สามารถลบร้าน default ได้' })
  }

  try {
    const pool = getPool()
    const existing = await pool.query(
      `SELECT id, slug, name, is_active FROM shops WHERE slug = $1 LIMIT 1`,
      [slug]
    )
    if (!existing.rows[0]) {
      return res.status(404).json({ error: 'ไม่พบร้าน' })
    }

    const shopId = existing.rows[0].id
    const bookingCount = await pool.query(
      `SELECT COUNT(*)::int AS count FROM bookings WHERE shop_id = $1`,
      [shopId]
    )
    if (bookingCount.rows[0]?.count > 0) {
      const result = await pool.query(
        `UPDATE shops SET is_active = false WHERE slug = $1
         RETURNING id, slug, name, is_active, created_at`,
        [slug]
      )
      return res.json({
        success: true,
        soft_deleted: true,
        message: 'ร้านมีข้อมูลการจอง — ปิดใช้งานแทนการลบถาวร',
        shop: result.rows[0],
      })
    }

    await pool.query(`DELETE FROM shop_admins WHERE shop_id = $1`, [shopId])
    await pool.query(`DELETE FROM shops WHERE id = $1`, [shopId])
    res.json({ success: true, soft_deleted: false, slug })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
