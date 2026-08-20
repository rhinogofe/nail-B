const router   = require('express').Router()
const passport = require('passport')
const { signToken } = require('../config/passport')
const auth     = require('../middleware/authMiddleware')
const { getPool } = require('../db/pool')
const { getAdminShopInfo } = require('../utils/shopAdmins')
const { createShopRecord } = require('../utils/createShopRecord')
const { UI_KEYS } = require('../utils/shopUiSettings')
const {
  isRegisterShopEnabled,
  verifyRegisterShopPin,
} = require('../utils/registerShopPin')

const providerEnv = {
  google: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL'],
  facebook: ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET', 'FACEBOOK_CALLBACK_URL'],
  line: ['LINE_CLIENT_ID', 'LINE_CLIENT_SECRET', 'LINE_CALLBACK_URL'],
}

function isProviderEnabled(provider) {
  const keys = providerEnv[provider] || []
  return keys.length > 0 && keys.every((key) => Boolean(process.env[key]))
}

function requireProvider(provider) {
  return (req, res, next) => {
    if (!isProviderEnabled(provider)) {
      return res.status(503).json({
        error: `OAuth provider '${provider}' is not configured on server`,
      })
    }
    next()
  }
}

function redirectWithToken(res, user, shopSlug = 'default') {
  const token = signToken(user)
  const base = String(process.env.FRONTEND_URL || 'http://localhost:5173').split(',')[0].trim()
  const slug = String(shopSlug || 'default').trim().toLowerCase() || 'default'
  res.redirect(`${base}/${slug}/auth/callback?token=${token}`)
}

function pickShopSlug(req) {
  const raw = req.query?.state || req.query?.shop || ''
  const slug = String(raw).trim().toLowerCase()
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : 'default'
}

function normalizePhone(phone) {
  return String(phone || '').replace(/[^\d+]/g, '').trim()
}

function normalizeLoginName(name) {
  return String(name || '').trim()
}

router.post('/phone-login', async (req, res) => {
  const name = normalizeLoginName(req.body?.name)
  const phone = normalizePhone(req.body?.phone)

  if (!name || !phone) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อและเบอร์โทร' })
  }

  try {
    const pool = getPool()

    const found = await pool.query(
      `
        SELECT *
        FROM users
        WHERE provider = 'phone'
          AND provider_id = $1
          AND lower(trim(name)) = lower(trim($2))
        LIMIT 1
      `,
      [phone, name]
    )

    let user = found.rows[0]

    if (!user) {
      const created = await pool.query(
        `INSERT INTO users (name, email, avatar_url, provider, provider_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [name, `${phone}@phone.local`, null, 'phone', phone]
      )
      user = created.rows[0]
    }

    const token = signToken(user)
    res.json({ token })
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'ชื่อและเบอร์นี้มีบัญชีแล้ว กรุณาตรวจสอบการสะกดชื่อ' })
    }
    res.status(500).json({ error: err.message })
  }
})

router.get('/register-shop/config', async (req, res) => {
  try {
    const pool = getPool()
    const enabled = await isRegisterShopEnabled(pool)
    res.json({ enabled })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/verify-register-pin', async (req, res) => {
  try {
    const pool = getPool()
    const result = await verifyRegisterShopPin(pool, req.body?.pin)
    if (!result.ok) {
      const status = result.error.includes('ยังไม่เปิด') ? 503 : 401
      return res.status(status).json({ error: result.error })
    }
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/register-shop', auth, async (req, res) => {
  const slug = String(req.body?.shop_slug || '').trim().toLowerCase()
  const shopName = String(req.body?.shop_name || '').trim()
  const ui = req.body?.ui && typeof req.body.ui === 'object' ? req.body.ui : {}
  const registerPin = req.body?.register_pin

  const registerRequiredUiKeys = new Set([
    'ui_brand_main',
    'ui_brand_accent',
    'ui_tagline',
    'ui_page_title',
    'ui_line_chat_url',
    'ui_bank_name',
    'ui_bank_account_name',
    'ui_bank_account_no',
  ])
  const missing = UI_KEYS.filter((key) => {
    if (!registerRequiredUiKeys.has(key)) return false
    return !String(ui[key] ?? '').trim()
  })
  if (!shopName) {
    return res.status(400).json({ error: 'กรุณาระบุชื่อร้าน' })
  }
  if (missing.length) {
    return res.status(400).json({
      error: 'กรุณากรอกข้อมูล UI ให้ครบทุกช่อง',
      fields: missing,
    })
  }

  const pool = getPool()
  const userId = req.user.id

  const pinCheck = await verifyRegisterShopPin(pool, registerPin)
  if (!pinCheck.ok) {
    const status = pinCheck.error.includes('ยังไม่เปิด') ? 503 : 401
    return res.status(status).json({ error: pinCheck.error })
  }

  try {
    const existingAdmin = await pool.query(
      `SELECT 1 FROM shop_admins WHERE user_id = $1 LIMIT 1`,
      [userId]
    )
    if (existingAdmin.rows.length) {
      return res.status(409).json({ error: 'บัญชีนี้มีร้านแล้ว กรุณาเข้าสู่ระบบแอดมิน' })
    }

    const client = await pool.connect()
    let shop
    try {
      await client.query('BEGIN')
      shop = await createShopRecord(client, { slug, name: shopName, uiSettings: ui })

      await client.query(
        `UPDATE users SET is_admin = true WHERE id = $1`,
        [userId]
      )
      await client.query(
        `INSERT INTO shop_admins (shop_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [shop.id, userId]
      )
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    const userRes = await pool.query(`SELECT * FROM users WHERE id = $1`, [userId])
    const user = userRes.rows[0]
    const token = signToken(user)
    const adminInfo = await getAdminShopInfo(pool, userId)

    res.status(201).json({
      success: true,
      shop,
      token,
      user: { ...user, ...adminInfo },
    })
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'slug นี้ถูกใช้แล้ว กรุณาเลือก slug อื่น' })
    }
    if (err.status) return res.status(err.status).json({ error: err.message })
    res.status(500).json({ error: err.message })
  }
})

router.get('/google',
  requireProvider('google'),
  passport.authenticate('google', { scope: ['profile', 'email'], session: false })
)
router.get('/google/callback',
  requireProvider('google'),
  passport.authenticate('google', { failureRedirect: `${String(process.env.FRONTEND_URL || '').split(',')[0].trim()}/default/login`, session: false }),
  (req, res) => redirectWithToken(res, req.user, pickShopSlug(req))
)

router.get('/facebook',
  requireProvider('facebook'),
  passport.authenticate('facebook', { scope: ['email'], session: false })
)
router.get('/facebook/callback',
  requireProvider('facebook'),
  passport.authenticate('facebook', { failureRedirect: `${String(process.env.FRONTEND_URL || '').split(',')[0].trim()}/default/login`, session: false }),
  (req, res) => redirectWithToken(res, req.user, pickShopSlug(req))
)

router.get('/line',
  requireProvider('line'),
  passport.authenticate('line', { session: false })
)
router.get('/line/callback',
  requireProvider('line'),
  passport.authenticate('line', { failureRedirect: `${String(process.env.FRONTEND_URL || '').split(',')[0].trim()}/default/login`, session: false }),
  (req, res) => redirectWithToken(res, req.user, pickShopSlug(req))
)

router.get('/me', auth, async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.query(
      `
        SELECT
          u.id,
          u.name,
          u.email,
          u.avatar_url,
          u.provider,
          u.provider_id,
          u.is_admin,
          u.receive_all_shop_push,
          u.total_points,
          u.created_at,
          COUNT(b.id)::int AS total_bookings,
          SUM(CASE WHEN b.status = 'done' THEN 1 ELSE 0 END)::int AS completed_bookings,
          SUM(CASE WHEN b.status = 'cancelled' THEN 1 ELSE 0 END)::int AS cancelled_bookings
        FROM users u
        LEFT JOIN bookings b ON b.user_id = u.id
        WHERE u.id = $1
        GROUP BY u.id, u.name, u.email, u.avatar_url, u.provider, u.provider_id, u.is_admin, u.receive_all_shop_push, u.total_points, u.created_at
      `,
      [req.user.id]
    )

    if (!result.rows[0]) return res.status(404).json({ error: 'ไม่พบผู้ใช้' })
    const user = result.rows[0]
    const token = signToken(user)
    if (user.is_admin) {
      const adminInfo = await getAdminShopInfo(pool, user.id)
      res.json({ ...user, ...adminInfo, token })
      return
    }
    res.json({
      ...user,
      is_super_admin: false,
      admin_shop_slug: null,
      managed_shop_slugs: [],
      token,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.patch('/profile', auth, async (req, res) => {
  const has = (key) => Object.prototype.hasOwnProperty.call(req.body, key)
  if (!has('name') && !has('phone')) {
    return res.status(400).json({ error: 'ไม่มีข้อมูลให้แก้ไข' })
  }

  try {
    const pool = getPool()
    const existing = await pool.query(
      `SELECT id, provider, provider_id, email, name FROM users WHERE id = $1`,
      [req.user.id]
    )
    if (!existing.rows.length) {
      return res.status(404).json({ error: 'ไม่พบผู้ใช้' })
    }
    const current = existing.rows[0]
    const fields = []
    const params = []

    if (has('name')) {
      const name = String(req.body.name || '').trim()
      if (!name) return res.status(400).json({ error: 'กรุณาระบุชื่อ' })
      params.push(name)
      fields.push(`name = $${params.length}`)
    }

    if (has('phone')) {
      if (current.provider !== 'phone') {
        return res.status(400).json({ error: 'แก้ไขเบอร์โทรได้เฉพาะบัญชีที่ล็อกอินด้วยเบอร์' })
      }
      const phone = normalizePhone(req.body.phone)
      if (!phone) return res.status(400).json({ error: 'กรุณาระบุเบอร์โทร' })
      params.push(phone)
      fields.push(`provider_id = $${params.length}`)
      if (String(current.email || '').endsWith('@phone.local')) {
        params.push(`${phone}@phone.local`)
        fields.push(`email = $${params.length}`)
      }
    }

    if (current.provider === 'phone' && (has('name') || has('phone'))) {
      const nextName = has('name') ? String(req.body.name).trim() : current.name
      const nextPhone = has('phone') ? normalizePhone(req.body.phone) : current.provider_id
      const dup = await pool.query(
        `SELECT id FROM users
         WHERE provider = 'phone' AND provider_id = $1 AND lower(trim(name)) = lower(trim($2)) AND id != $3
         LIMIT 1`,
        [nextPhone, nextName, req.user.id]
      )
      if (dup.rows.length) {
        return res.status(409).json({ error: 'ชื่อและเบอร์นี้ถูกใช้แล้ว' })
      }
    }

    if (!fields.length) {
      return res.status(400).json({ error: 'ไม่มีข้อมูลให้แก้ไข' })
    }

    params.push(req.user.id)
    const result = await pool.query(
      `
        UPDATE users
        SET ${fields.join(', ')}
        WHERE id = $${params.length}
        RETURNING id, name, email, avatar_url, provider, provider_id, is_admin, total_points, created_at
      `,
      params
    )

    const user = result.rows[0]
    const stats = await pool.query(
      `
        SELECT
          COUNT(*)::int AS total_bookings,
          SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END)::int AS completed_bookings,
          SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END)::int AS cancelled_bookings
        FROM bookings
        WHERE user_id = $1
      `,
      [req.user.id]
    )

    res.json({
      success: true,
      message: 'บันทึกข้อมูลแล้ว',
      user: {
        ...user,
        ...stats.rows[0],
      },
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
