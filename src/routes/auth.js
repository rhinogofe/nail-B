const router   = require('express').Router()
const passport = require('passport')
const { signToken } = require('../config/passport')
const auth     = require('../middleware/authMiddleware')
const { getPool } = require('../db/pool')

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

function redirectWithToken(res, user) {
  const token = signToken(user)
  res.redirect(`${process.env.FRONTEND_URL}/auth/callback?token=${token}`)
}

function normalizePhone(phone) {
  return String(phone || '').replace(/[^\d+]/g, '').trim()
}

router.post('/phone-login', async (req, res) => {
  const name = String(req.body?.name || '').trim()
  const phone = normalizePhone(req.body?.phone)

  if (!name || !phone) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อและเบอร์โทร' })
  }

  try {
    const pool = getPool()

    const found = await pool.query(
      `SELECT * FROM users WHERE provider = $1 AND provider_id = $2 LIMIT 1`,
      ['phone', phone]
    )

    let user = found.rows[0]

    if (user) {
      const updated = await pool.query(
        `UPDATE users SET name = $1 WHERE id = $2 RETURNING *`,
        [name, user.id]
      )
      user = updated.rows[0]
    } else {
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
    res.status(500).json({ error: err.message })
  }
})

router.get('/google',
  requireProvider('google'),
  passport.authenticate('google', { scope: ['profile', 'email'], session: false })
)
router.get('/google/callback',
  requireProvider('google'),
  passport.authenticate('google', { failureRedirect: `${process.env.FRONTEND_URL}/login`, session: false }),
  (req, res) => redirectWithToken(res, req.user)
)

router.get('/facebook',
  requireProvider('facebook'),
  passport.authenticate('facebook', { scope: ['email'], session: false })
)
router.get('/facebook/callback',
  requireProvider('facebook'),
  passport.authenticate('facebook', { failureRedirect: `${process.env.FRONTEND_URL}/login`, session: false }),
  (req, res) => redirectWithToken(res, req.user)
)

router.get('/line',
  requireProvider('line'),
  passport.authenticate('line', { session: false })
)
router.get('/line/callback',
  requireProvider('line'),
  passport.authenticate('line', { failureRedirect: `${process.env.FRONTEND_URL}/login`, session: false }),
  (req, res) => redirectWithToken(res, req.user)
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
          u.total_points,
          u.created_at,
          COUNT(b.id)::int AS total_bookings,
          SUM(CASE WHEN b.status = 'done' THEN 1 ELSE 0 END)::int AS completed_bookings,
          SUM(CASE WHEN b.status = 'cancelled' THEN 1 ELSE 0 END)::int AS cancelled_bookings
        FROM users u
        LEFT JOIN bookings b ON b.user_id = u.id
        WHERE u.id = $1
        GROUP BY u.id, u.name, u.email, u.avatar_url, u.provider, u.provider_id, u.is_admin, u.total_points, u.created_at
      `,
      [req.user.id]
    )

    if (!result.rows[0]) return res.status(404).json({ error: 'ไม่พบผู้ใช้' })
    res.json(result.rows[0])
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
      `SELECT id, provider, provider_id, email FROM users WHERE id = $1`,
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
      const dup = await pool.query(
        `SELECT id FROM users WHERE provider = 'phone' AND provider_id = $1 AND id != $2 LIMIT 1`,
        [phone, req.user.id]
      )
      if (dup.rows.length) {
        return res.status(409).json({ error: 'เบอร์โทรนี้ถูกใช้แล้ว' })
      }
      params.push(phone)
      fields.push(`provider_id = $${params.length}`)
      if (String(current.email || '').endsWith('@phone.local')) {
        params.push(`${phone}@phone.local`)
        fields.push(`email = $${params.length}`)
      }
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
