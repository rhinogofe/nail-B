const { getShopSettings } = require('./shopSettings')
const { notifyBookingCancelledChat } = require('./bookingChatNotify')
const { emitBookingChanged } = require('./bookingEvents')
const { deletePaymentSlipByBookingId } = require('./bookingPaymentSlips')

const DEFAULT_HOURS = 24
const MIN_HOURS = 1
const MAX_HOURS = 168

async function getUnpaidExpireSettings(poolOrClient, shopId) {
  const map = await getShopSettings(poolOrClient, shopId, [
    'unpaid_auto_cancel_enabled',
    'unpaid_expire_hours',
  ])
  const enabled = map.unpaid_auto_cancel_enabled !== 'false'
  let hours = Number(map.unpaid_expire_hours)
  if (!Number.isFinite(hours) || hours < MIN_HOURS) hours = DEFAULT_HOURS
  if (hours > MAX_HOURS) hours = MAX_HOURS
  return { enabled, expireHours: hours }
}

function computeExpiresAt(createdAt, expireHours) {
  const created = new Date(createdAt)
  if (Number.isNaN(created.getTime())) return null
  return new Date(created.getTime() + expireHours * 60 * 60 * 1000)
}

function isBookingExpired(createdAt, expireHours, enabled) {
  if (!enabled || !createdAt) return false
  const expiresAt = computeExpiresAt(createdAt, expireHours)
  if (!expiresAt) return false
  return Date.now() >= expiresAt.getTime()
}

async function expireUnpaidBookings(poolOrClient, shopId = null) {
  if (shopId) {
    const { enabled, expireHours } = await getUnpaidExpireSettings(poolOrClient, shopId)
    if (!enabled) return 0
    const result = await poolOrClient.query(
      `
        UPDATE bookings
        SET status = 'cancelled'
        WHERE shop_id = $1
          AND status = 'awaiting_payment'
          AND created_at < NOW() - ($2::int * INTERVAL '1 hour')
        RETURNING id, shop_id, booking_date
      `,
      [shopId, expireHours]
    )
    for (const row of result.rows) {
      await deletePaymentSlipByBookingId(poolOrClient, row.id)
      notifyBookingCancelledChat(poolOrClient, row.shop_id, row.id).catch(() => null)
      emitBookingChanged(row.shop_id, {
        type: 'auto_cancelled',
        booking_id: row.id,
        booking_date: row.booking_date,
      })
    }
    return result.rowCount || 0
  }

  const shops = await poolOrClient.query(`SELECT id FROM shops WHERE is_active = true`)
  let total = 0
  for (const row of shops.rows) {
    total += await expireUnpaidBookings(poolOrClient, row.id)
  }
  return total
}

module.exports = {
  DEFAULT_HOURS,
  MIN_HOURS,
  MAX_HOURS,
  getUnpaidExpireSettings,
  computeExpiresAt,
  isBookingExpired,
  expireUnpaidBookings,
}
