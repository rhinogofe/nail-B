const DEFAULT_HOURS = 24
const MIN_HOURS = 1
const MAX_HOURS = 168

async function getUnpaidExpireSettings(poolOrClient) {
  const result = await poolOrClient.query(
    `SELECT setting_key, setting_value FROM app_settings
     WHERE setting_key IN ('unpaid_auto_cancel_enabled', 'unpaid_expire_hours')`
  )
  const map = Object.fromEntries(result.rows.map((r) => [r.setting_key, r.setting_value]))
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

async function expireUnpaidBookings(poolOrClient) {
  const { enabled, expireHours } = await getUnpaidExpireSettings(poolOrClient)
  if (!enabled) return 0

  const result = await poolOrClient.query(
    `
      UPDATE bookings
      SET status = 'cancelled'
      WHERE status = 'awaiting_payment'
        AND created_at < NOW() - ($1::int * INTERVAL '1 hour')
    `,
    [expireHours]
  )
  return result.rowCount || 0
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
