require('dotenv').config()

const express = require('express')
const cors    = require('cors')
const { passport } = require('./config/passport')
const { ensureSchema } = require('./db/ensureSchema')

const app = express()

app.use(cors({
  origin:      process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}))
app.use(express.json())
app.use(passport.initialize())

app.use('/api/auth',     require('./routes/auth'))
app.use('/api/bookings', require('./routes/bookings'))
app.use('/api/admin',    require('./routes/admin'))
app.use('/api/coupons',  require('./routes/coupons'))

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
}

startServer()
