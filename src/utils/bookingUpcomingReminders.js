const { todayYmdBangkok } = require('./bookingWindow')
const { getChatNotifySettings } = require('./chatNotifySettings')
const {
  notifyAdminUpcomingChat,
  notifyCustomerUpcomingChat,
} = require('./bookingChatNotify')

function bookingStartMs(bookingDate, startHour, startMinute) {
  const h = Number(startHour)
  const m = Number(startMinute) || 0
  const iso = `${bookingDate}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+07:00`
  return new Date(iso).getTime()
}

function minutesUntilStart(bookingDate, startHour, startMinute, nowMs = Date.now()) {
  const startMs = bookingStartMs(bookingDate, startHour, startMinute)
  return Math.floor((startMs - nowMs) / 60000)
}

async function processUpcomingBookingReminders(pool) {
  const today = todayYmdBangkok()
  const nowMs = Date.now()

  const shopsRes = await pool.query(`SELECT id FROM shops WHERE is_active = true`)
  let sentAdmin = 0
  let sentCustomer = 0

  for (const shop of shopsRes.rows) {
    const settings = await getChatNotifySettings(pool, shop.id)
    if (!settings.upcomingAdminEnabled && !settings.upcomingCustomerEnabled) continue

    const windowMinutes = settings.upcomingMinutes
    const bookingsRes = await pool.query(
      `
        SELECT
          id,
          booking_date,
          start_hour,
          start_minute,
          chat_admin_upcoming_sent_at,
          chat_customer_upcoming_sent_at
        FROM bookings
        WHERE shop_id = $1
          AND booking_date = $2
          AND status IN ('pending', 'awaiting_payment')
      `,
      [shop.id, today]
    )

    for (const row of bookingsRes.rows) {
      const minutes = minutesUntilStart(row.booking_date, row.start_hour, row.start_minute, nowMs)
      if (minutes <= 0 || minutes > windowMinutes) continue

      if (settings.upcomingAdminEnabled && !row.chat_admin_upcoming_sent_at) {
        const result = await notifyAdminUpcomingChat(pool, shop.id, row.id, minutes)
        if (result.ok) {
          await pool.query(
            `UPDATE bookings SET chat_admin_upcoming_sent_at = NOW() WHERE id = $1`,
            [row.id]
          )
          sentAdmin += 1
        }
      }

      if (settings.upcomingCustomerEnabled && !row.chat_customer_upcoming_sent_at) {
        const result = await notifyCustomerUpcomingChat(pool, shop.id, row.id, minutes)
        if (result.ok) {
          await pool.query(
            `UPDATE bookings SET chat_customer_upcoming_sent_at = NOW() WHERE id = $1`,
            [row.id]
          )
          sentCustomer += 1
        }
      }
    }
  }

  return { sentAdmin, sentCustomer }
}

module.exports = {
  processUpcomingBookingReminders,
  minutesUntilStart,
  bookingStartMs,
}
