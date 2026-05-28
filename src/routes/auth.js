const router   = require('express').Router()
const passport = require('passport')
const { signToken } = require('../config/passport')
const auth     = require('../middleware/authMiddleware')
const { sql, getPool } = require('../db/pool')

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

// ─── Helper: redirect back to frontend with token ─────────────
function redirectWithToken(res, user) {
  const token = signToken(user)
  res.redirect(`${process.env.FRONTEND_URL}/auth/callback?token=${token}`)
}

function normalizePhone(phone) {
  return String(phone || '').replace(/[^\d+]/g, '').trim()
}

// ─── POST /api/auth/phone-login ────────────────────────────────
// ล็อกอินด้วยชื่อ + เบอร์โทร (ไม่ต้อง OAuth)
router.post('/phone-login', async (req, res) => {
  const name = String(req.body?.name || '').trim()
  const phone = normalizePhone(req.body?.phone)

  if (!name || !phone) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อและเบอร์โทร' })
  }

  try {
    const pool = await getPool()

    const found = await pool.request()
      .input('provider', sql.NVarChar, 'phone')
      .input('providerId', sql.NVarChar, phone)
      .query(`
        SELECT TOP 1 *
        FROM users
        WHERE provider = @provider AND provider_id = @providerId
      `)

    let user = found.recordset[0]

    if (user) {
      await pool.request()
        .input('id', sql.UniqueIdentifier, user.id)
        .input('name', sql.NVarChar, name)
        .query(`UPDATE users SET name = @name WHERE id = @id`)
      user.name = name
    } else {
      const created = await pool.request()
        .input('name', sql.NVarChar, name)
        .input('email', sql.NVarChar, `${phone}@phone.local`)
        .input('avatarUrl', sql.NVarChar, null)
        .input('provider', sql.NVarChar, 'phone')
        .input('providerId', sql.NVarChar, phone)
        .query(`
          INSERT INTO users (name, email, avatar_url, provider, provider_id)
          OUTPUT INSERTED.*
          VALUES (@name, @email, @avatarUrl, @provider, @providerId)
        `)
      user = created.recordset[0]
    }

    const token = signToken(user)
    res.json({ token })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Google ───────────────────────────────────────────────────
router.get('/google',
  requireProvider('google'),
  passport.authenticate('google', { scope: ['profile', 'email'], session: false })
)
router.get('/google/callback',
  requireProvider('google'),
  passport.authenticate('google', { failureRedirect: `${process.env.FRONTEND_URL}/login`, session: false }),
  (req, res) => redirectWithToken(res, req.user)
)

// ─── Facebook ─────────────────────────────────────────────────
router.get('/facebook',
  requireProvider('facebook'),
  passport.authenticate('facebook', { scope: ['email'], session: false })
)
router.get('/facebook/callback',
  requireProvider('facebook'),
  passport.authenticate('facebook', { failureRedirect: `${process.env.FRONTEND_URL}/login`, session: false }),
  (req, res) => redirectWithToken(res, req.user)
)

// ─── LINE ─────────────────────────────────────────────────────
router.get('/line',
  requireProvider('line'),
  passport.authenticate('line', { session: false })
)
router.get('/line/callback',
  requireProvider('line'),
  passport.authenticate('line', { failureRedirect: `${process.env.FRONTEND_URL}/login`, session: false }),
  (req, res) => redirectWithToken(res, req.user)
)

// ─── GET /api/auth/me ─────────────────────────────────────────
router.get('/me', auth, async (req, res) => {
  try {
    const pool = await getPool()
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, req.user.id)
      .query(`SELECT id, name, email, avatar_url, is_admin, total_points, created_at
              FROM users WHERE id = @id`)

    if (!result.recordset[0]) return res.status(404).json({ error: 'ไม่พบผู้ใช้' })
    res.json(result.recordset[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
