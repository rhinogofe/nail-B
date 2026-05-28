require('dotenv').config()

const express = require('express')
const cors    = require('cors')
const { passport } = require('./config/passport')
const { ensureBookingStatusConstraint } = require('./db/ensureBookingStatusConstraint')
const { ensureBookingBlocksTable } = require('./db/ensureBookingBlocksTable')
const { ensureUserProviderConstraint } = require('./db/ensureUserProviderConstraint')
const { ensureAppSettingsTable } = require('./db/ensureAppSettingsTable')
const { ensureNailoptionTable } = require('./db/ensureNailoptionTable')
const { ensureBookingNailoptionTable } = require('./db/ensureBookingNailoptionTable')
const { ensureCouponsTable } = require('./db/ensureCouponsTable')

const app = express()

// ─── Middleware ───────────────────────────────────────────────
app.use(cors({
  origin:      process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}))
app.use(express.json())
app.use(passport.initialize())

// ─── Routes ───────────────────────────────────────────────────
app.use('/api/auth',     require('./routes/auth'))
app.use('/api/bookings', require('./routes/bookings'))
app.use('/api/admin',    require('./routes/admin'))
app.use('/api/coupons',  require('./routes/coupons'))

// ─── Health check ─────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }))

// ─── Global error handler ─────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).json({ error: 'Server error' })
})

// ─── Start ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000

async function startServer() {
  try {
    await ensureBookingStatusConstraint()
    await ensureBookingBlocksTable()
    await ensureUserProviderConstraint()
    await ensureAppSettingsTable()
    await ensureNailoptionTable()
    await ensureBookingNailoptionTable()
    await ensureCouponsTable()
  } catch (err) {
    console.error('⚠️ Startup DB migration warning:', err.message)
  }

  app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`)
  })
}

startServer()
