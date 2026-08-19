require('dotenv').config()

const express = require('express')
const cors    = require('cors')
const { passport } = require('./config/passport')
const { createCorsOptions } = require('./config/cors')
const {
  ensureSchema,
  ensureShopUsageColumns,
  ensureServiceCategoriesSchema,
  ensureChatNotifySchema,
  ensureFcmTokensSchema,
} = require('./db/ensureSchema')
const { getPool } = require('./db/pool')
const { expireUnpaidBookings } = require('./utils/unpaidExpire')
const { processUpcomingBookingReminders } = require('./utils/bookingUpcomingReminders')
const { expireOldChatImages } = require('./utils/chatImages')
const { logLineBotTokenStatus } = require('./utils/linePushSettings')
const {
  ensureUploadDirs,
  getUploadRoot,
  recordStorageMarker,
  getStorageMarker,
} = require('./utils/uploadPaths')

const app = express()

app.use(cors(createCorsOptions()))

app.use('/api/line/webhook', require('./routes/lineWebhook'))

app.use(express.json({ limit: '3mb' }))
app.use(passport.initialize())

app.use('/api/auth',     require('./routes/auth'))
app.use('/api/shops',    require('./routes/shops'))
app.use('/api/bookings', require('./routes/bookings'))
app.use('/api/admin',    require('./routes/admin'))
app.use('/api/coupons',  require('./routes/coupons'))
app.use('/api/reviews',  require('./routes/reviews'))
app.use('/api/chat',     require('./routes/chat'))
app.use('/api/push',     require('./routes/push'))

app.get('/health', (req, res) => {
  const marker = getStorageMarker()
  res.json({
    status: 'ok',
    upload_root: getUploadRoot(),
    upload_persistent: marker.persistent,
    upload_first_seen_at: marker.firstSeenAt,
    upload_boot_count: marker.bootCount,
  })
})

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

  try {
    const pool = await getPool()
    await ensureShopUsageColumns(pool)
    await ensureServiceCategoriesSchema(pool)
    await ensureChatNotifySchema(pool)
    await ensureFcmTokensSchema(pool)
  } catch (err) {
    console.error('⚠️ Critical schema migration:', err.message)
  }

  let storage = getStorageMarker()
  try {
    await ensureUploadDirs()
    storage = await recordStorageMarker()
  } catch (err) {
    console.error('⚠️ Upload directory warning:', err.message)
  }

  app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`)
    console.log(`📁 Upload root: ${getUploadRoot()}`)
    if (storage.bootCount > 1) {
      console.log(`💾 Storage persists across restarts (boot #${storage.bootCount}, since ${storage.firstSeenAt})`)
    } else {
      console.warn('⚠️ Storage looks empty on boot — attach a Render Persistent Disk at UPLOAD_ROOT or uploaded images will be lost on every deploy')
    }
    logLineBotTokenStatus()
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

  async function runUpcomingReminders() {
    try {
      const pool = getPool()
      const { sentAdmin, sentCustomer } = await processUpcomingBookingReminders(pool)
      if (sentAdmin > 0 || sentCustomer > 0) {
        console.log(`🔔 Sent upcoming reminders — admin: ${sentAdmin}, customer: ${sentCustomer}`)
      }
    } catch (err) {
      console.error('processUpcomingBookingReminders:', err.message)
    }
  }

  runUpcomingReminders()
  setInterval(runUpcomingReminders, 60 * 1000)

  async function runChatImageCleanup() {
    try {
      const pool = getPool()
      const count = await expireOldChatImages(pool)
      if (count > 0) console.log(`🖼️ Removed ${count} expired chat image(s)`)
    } catch (err) {
      console.error('expireOldChatImages:', err.message)
    }
  }

  runChatImageCleanup()
  setInterval(runChatImageCleanup, 60 * 60 * 1000)
}

startServer()
