const { getShopSetting } = require('./shopSettings')

const MIN_SLOT_HOURS = 1
const MAX_SLOT_HOURS = 4
const DEFAULT_SLOT_HOURS = 2
const DEFAULT_DISPLAY_MODE = 'slots_2h'

function normalizeBookingDisplayMode(value) {
  if (value === 'normal') return 'normal'
  return DEFAULT_DISPLAY_MODE
}

function normalizeBookingSlotHours(value) {
  const n = Number(value)
  if (Number.isInteger(n) && n >= MIN_SLOT_HOURS && n <= MAX_SLOT_HOURS) return n
  return DEFAULT_SLOT_HOURS
}

async function getBookingSlotHours(poolOrClient, shopId) {
  const raw = await getShopSetting(poolOrClient, shopId, 'booking_slot_hours')
  return normalizeBookingSlotHours(raw)
}

function bookingEndHour(startHour, slotHours) {
  return Number(startHour) + normalizeBookingSlotHours(slotHours)
}

function bookingEndHourFromRow(row, slotHours = DEFAULT_SLOT_HOURS) {
  if (row?.end_hour != null && row.end_hour !== '') return Number(row.end_hour)
  return bookingEndHour(row.start_hour, slotHours)
}

module.exports = {
  MIN_SLOT_HOURS,
  MAX_SLOT_HOURS,
  DEFAULT_SLOT_HOURS,
  DEFAULT_DISPLAY_MODE,
  normalizeBookingDisplayMode,
  normalizeBookingSlotHours,
  getBookingSlotHours,
  bookingEndHour,
  bookingEndHourFromRow,
}
