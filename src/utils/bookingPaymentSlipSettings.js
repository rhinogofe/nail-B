const { getShopSettings, setShopSettings, ensureShopSettings } = require('./shopSettings')

const SETTING_KEY = 'booking_slip_retention_days'
const DEFAULT_RETENTION_DAYS = 3

function parseRetentionDays(value, fallback = DEFAULT_RETENTION_DAYS) {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.min(n, 90)
}

async function getBookingSlipRetentionDays(poolOrClient, shopId) {
  if (!shopId) return DEFAULT_RETENTION_DAYS

  await ensureShopSettings(poolOrClient, shopId, {
    [SETTING_KEY]: String(DEFAULT_RETENTION_DAYS),
  })

  const map = await getShopSettings(poolOrClient, shopId, [SETTING_KEY])
  return parseRetentionDays(map[SETTING_KEY], DEFAULT_RETENTION_DAYS)
}

async function setBookingSlipRetentionDays(poolOrClient, shopId, days) {
  if (!shopId) throw new Error('ไม่พบร้าน')

  const value = parseRetentionDays(days, DEFAULT_RETENTION_DAYS)
  await setShopSettings(poolOrClient, shopId, {
    [SETTING_KEY]: String(value),
  })
  return value
}

module.exports = {
  SETTING_KEY,
  DEFAULT_RETENTION_DAYS,
  parseRetentionDays,
  getBookingSlipRetentionDays,
  setBookingSlipRetentionDays,
}
