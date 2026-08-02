const router = require('express').Router()
const auth = require('../middleware/authMiddleware')
const admin = require('../middleware/adminMiddleware')
const { getPool } = require('../db/pool')
const { ensureShopSettings } = require('../utils/shopSettings')
const { ensureUiSettings } = require('../utils/shopUiSettings')
const { computeBookUntilDate, todayYmdBangkok } = require('../utils/bookingWindow')
const { isSuperAdmin } = require('../utils/shopAdmins')

const DEFAULT_SETTINGS = {
  deposit_amount: '300',
  shop_open_hour: '9',
  shop_last_booking_hour: '18',
  book_advance_days: '30',
  booking_display_mode: 'normal',
  unpaid_auto_cancel_enabled: 'true',
  unpaid_expire_hours: '24',
  line_push_enabled: 'false',
  booking_slot_hours: '2',
  coupon_discount_percent: '20',
  coupon_required_points: '100',
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

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
      `SELECT id, slug, name, is_active, created_at
       FROM shops
       WHERE is_active = true
       ORDER BY name ASC`
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/:slug', async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.query(
      `SELECT id, slug, name, is_active, created_at
       FROM shops
       WHERE slug = $1 AND is_active = true
       LIMIT 1`,
      [req.params.slug.toLowerCase()]
    )
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'ไม่พบร้าน' })
    }
    res.json(result.rows[0])
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

  try {
    const pool = getPool()
    const created = await pool.query(
      `INSERT INTO shops (slug, name) VALUES ($1, $2)
       RETURNING id, slug, name, is_active, created_at`,
      [slug, name]
    )
    const shop = created.rows[0]
    await ensureShopSettings(pool, shop.id, {
      ...DEFAULT_SETTINGS,
      book_until_date: computeBookUntilDate(30, todayYmdBangkok()),
    })
    await ensureUiSettings(pool, shop.id)
    await pool.query(
      `INSERT INTO service_locations (shop_id, name, color, description, sort_order)
       VALUES
         ($1, 'จุฬา', '#3b82f6', 'สถานที่ให้บริการ จุฬา', 1),
         ($1, 'เกษตร', '#22c55e', 'สถานที่ให้บริการ เกษตร', 2)
       ON CONFLICT DO NOTHING`,
      [shop.id]
    )
    res.status(201).json({ success: true, shop })
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'slug นี้ถูกใช้แล้ว' })
    }
    res.status(500).json({ error: err.message })
  }
})

router.patch('/:slug', auth, admin, requireSuperAdminUser, async (req, res) => {
  const name = req.body?.name != null ? String(req.body.name).trim() : null
  const isActive = req.body?.is_active

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
    if (!fields.length) {
      return res.status(400).json({ error: 'ไม่มีข้อมูลให้แก้ไข' })
    }

    params.push(req.params.slug.toLowerCase())
    const result = await pool.query(
      `UPDATE shops SET ${fields.join(', ')}
       WHERE slug = $${params.length}
       RETURNING id, slug, name, is_active, created_at`,
      params
    )
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'ไม่พบร้าน' })
    }
    res.json({ success: true, shop: result.rows[0] })
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

    const bookingCount = await pool.query(
      `SELECT COUNT(*)::int AS count FROM bookings WHERE shop_id = $1`,
      [existing.rows[0].id]
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

    await pool.query(`DELETE FROM shops WHERE slug = $1`, [slug])
    res.json({ success: true, soft_deleted: false, slug })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
