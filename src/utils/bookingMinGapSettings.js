const { getShopSettings } = require('./shopSettings')

const DEFAULT_MIN_GAP_MINUTES = 60
const MIN_GAP_MINUTES_FLOOR = 15
const MIN_GAP_MINUTES_CEIL = 120

function normalizeBookingMinGapMinutes(value) {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return DEFAULT_MIN_GAP_MINUTES
  return Math.min(MIN_GAP_MINUTES_CEIL, Math.max(MIN_GAP_MINUTES_FLOOR, n))
}

function isBookingMinGapEnabled(map = {}) {
  return map.booking_min_gap_enabled === 'true'
}

async function getBookingMinGapSettings(poolOrClient, shopId) {
  const map = await getShopSettings(poolOrClient, shopId, [
    'booking_min_gap_enabled',
    'booking_min_gap_minutes',
  ])
  return {
    enabled: isBookingMinGapEnabled(map),
    minutes: normalizeBookingMinGapMinutes(map.booking_min_gap_minutes ?? DEFAULT_MIN_GAP_MINUTES),
  }
}

async function getEffectiveBookingMinGapMinutes(poolOrClient, shopId) {
  const { enabled, minutes } = await getBookingMinGapSettings(poolOrClient, shopId)
  return enabled ? minutes : DEFAULT_MIN_GAP_MINUTES
}

module.exports = {
  DEFAULT_MIN_GAP_MINUTES,
  MIN_GAP_MINUTES_FLOOR,
  MIN_GAP_MINUTES_CEIL,
  normalizeBookingMinGapMinutes,
  isBookingMinGapEnabled,
  getBookingMinGapSettings,
  getEffectiveBookingMinGapMinutes,
}
