const passport         = require('passport')
const GoogleStrategy   = require('passport-google-oauth20').Strategy
const FacebookStrategy = require('passport-facebook').Strategy
const LineStrategy     = require('passport-line').Strategy
const jwt              = require('jsonwebtoken')
const { sql, getPool } = require('../db/pool')

function hasEnv(...keys) {
  return keys.every((key) => Boolean(process.env[key]))
}

// ─── upsert user ─────────────────────────────────────────────
async function findOrCreateUser({ provider, providerId, name, email, avatarUrl }) {
  const pool = await getPool()

  const found = await pool.request()
    .input('provider',   sql.NVarChar, provider)
    .input('providerId', sql.NVarChar, providerId)
    .query(`SELECT * FROM users WHERE provider=@provider AND provider_id=@providerId`)

  if (found.recordset.length > 0) return found.recordset[0]

  const created = await pool.request()
    .input('name',       sql.NVarChar, name)
    .input('email',      sql.NVarChar, email || `${providerId}@${provider}.local`)
    .input('avatarUrl',  sql.NVarChar, avatarUrl || null)
    .input('provider',   sql.NVarChar, provider)
    .input('providerId', sql.NVarChar, providerId)
    .query(`
      INSERT INTO users (name, email, avatar_url, provider, provider_id)
      OUTPUT INSERTED.*
      VALUES (@name, @email, @avatarUrl, @provider, @providerId)
    `)

  return created.recordset[0]
}

// ─── Google ───────────────────────────────────────────────────
if (hasEnv('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL')) {
  passport.use(new GoogleStrategy({
    clientID:     process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL:  process.env.GOOGLE_CALLBACK_URL,
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const user = await findOrCreateUser({
        provider:   'google',
        providerId: profile.id,
        name:       profile.displayName,
        email:      profile.emails?.[0]?.value,
        avatarUrl:  profile.photos?.[0]?.value,
      })
      done(null, user)
    } catch (err) { done(err) }
  }))
}

// ─── Facebook ─────────────────────────────────────────────────
if (hasEnv('FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET', 'FACEBOOK_CALLBACK_URL')) {
  passport.use(new FacebookStrategy({
    clientID:      process.env.FACEBOOK_APP_ID,
    clientSecret:  process.env.FACEBOOK_APP_SECRET,
    callbackURL:   process.env.FACEBOOK_CALLBACK_URL,
    profileFields: ['id', 'displayName', 'emails', 'photos'],
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const user = await findOrCreateUser({
        provider:   'facebook',
        providerId: profile.id,
        name:       profile.displayName,
        email:      profile.emails?.[0]?.value,
        avatarUrl:  profile.photos?.[0]?.value,
      })
      done(null, user)
    } catch (err) { done(err) }
  }))
}

// ─── LINE ─────────────────────────────────────────────────────
if (hasEnv('LINE_CLIENT_ID', 'LINE_CLIENT_SECRET', 'LINE_CALLBACK_URL')) {
  passport.use(new LineStrategy({
    channelID:     process.env.LINE_CLIENT_ID,
    channelSecret: process.env.LINE_CLIENT_SECRET,
    callbackURL:   process.env.LINE_CALLBACK_URL,
    scope: ['profile', 'openid', 'email'],
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const user = await findOrCreateUser({
        provider:   'line',
        providerId: profile.id,
        name:       profile.displayName,
        email:      profile.emails?.[0]?.value,
        avatarUrl:  profile.pictureUrl,
      })
      done(null, user)
    } catch (err) { done(err) }
  }))
}

// ─── sign JWT ─────────────────────────────────────────────────
function signToken(user) {
  return jwt.sign(
    { id: user.id, is_admin: user.is_admin },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  )
}

module.exports = { passport, signToken }
