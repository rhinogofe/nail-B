const { normalizeBookingSlotHours, DEFAULT_SLOT_HOURS } = require('./bookingSlotHours')

function toMinutes(hour, minute = 0) {
  return Number(hour) * 60 + Number(minute ?? 0)
}

function normalizeMinute(value) {
  const n = Number(value ?? 0)
  if (!Number.isInteger(n) || n < 0 || n > 59) return 0
  return n
}

function normalizeSlotInput(body, slotHours = DEFAULT_SLOT_HOURS) {
  const slot = normalizeBookingSlotHours(slotHours)
  const startHour = Number(body?.start_hour)
  const startMinute = normalizeMinute(body?.start_minute)
  if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23) return null

  let endHour = body?.end_hour != null ? Number(body.end_hour) : startHour + slot
  let endMinute = body?.end_minute != null ? normalizeMinute(body.end_minute) : 0
  if (!Number.isInteger(endHour) || endHour < 0 || endHour > 23) {
    endHour = startHour + slot
    endMinute = 0
  }

  const startM = toMinutes(startHour, startMinute)
  const endM = toMinutes(endHour, endMinute)
  if (endM <= startM) return null

  return { startHour, startMinute, endHour, endMinute, startM, endM }
}

function rangesOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA
}

function matchesDayWindowSlot(slot, dayWindows) {
  return (dayWindows || []).some((w) =>
    Number(w.start_hour) === slot.startHour
    && normalizeMinute(w.start_minute) === slot.startMinute
    && Number(w.end_hour) === slot.endHour
    && normalizeMinute(w.end_minute) === slot.endMinute
  )
}

function matchesDayWindowStart(slot, dayWindows) {
  return (dayWindows || []).some((w) =>
    Number(w.start_hour) === slot.startHour
    && normalizeMinute(w.start_minute) === slot.startMinute
  )
}

function bookingRowToMinutes(row, slotHours = DEFAULT_SLOT_HOURS) {
  const slot = normalizeBookingSlotHours(slotHours)
  const startHour = Number(row.start_hour)
  const startMinute = normalizeMinute(row.start_minute)
  const endHour = row.end_hour != null ? Number(row.end_hour) : startHour + slot
  const endMinute = row.end_minute != null ? normalizeMinute(row.end_minute) : 0
  return {
    startM: toMinutes(startHour, startMinute),
    endM: toMinutes(endHour, endMinute),
  }
}

module.exports = {
  toMinutes,
  normalizeMinute,
  normalizeSlotInput,
  rangesOverlap,
  matchesDayWindowSlot,
  matchesDayWindowStart,
  bookingRowToMinutes,
}
