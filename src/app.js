require('dotenv').config()

const express = require('express')
const cors    = require('cors')
const { passport } = require('./config/passport')
const { ensureSchema } = require('./db/ensureSchema')
const { getPool } = require('./db/pool')
const { expireUnpaidBookings } = require('./utils/unpaidExpire')

const app = express()

const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true)
      return
    }
    callback(null, false)
  },
  credentials: true,
}))
app.use(express.json())
app.use(passport.initialize())

app.use('/api/auth',     require('./routes/auth'))
app.use('/api/bookings', require('./routes/bookings'))
app.use('/api/admin',    require('./routes/admin'))
app.use('/api/coupons',  require('./routes/coupons'))
app.use('/api/reviews',  require('./routes/reviews'))

app.get('/health', (req, res) => res.json({ status: 'ok' }))

app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).json({ error: 'Server error' })
})

const PORT = process.env.PORT || 3000

async function startServer() {
  try {
    await ensureSchema()
  } catch (err) {
    console.error('⚠️ Startup DB migration warning:', err.message)
  }

  app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`)
  })

  setInterval(async () => {
    try {
      const pool = getPool()
      const count = await expireUnpaidBookings(pool)
      if (count > 0) console.log(`⏱️ Auto-cancelled ${count} unpaid booking(s)`)
    } catch (err) {
      console.error('expireUnpaidBookings:', err.message)
    }
  }, 5 * 60 * 1000)
}

startServer()
