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
      `SELECT id, name, email, avatar_url, is_admin, total_points, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    )

    if (!result.rows[0]) return res.status(404).json({ error: 'ไม่พบผู้ใช้' })
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
