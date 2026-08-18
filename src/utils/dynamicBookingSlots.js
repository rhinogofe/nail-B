const { getDayHoursForDate } = require('./bookingDayHours')
const { getShopHours } = require('./bookingHours')
const { normalizeBookingSlotHours, DEFAULT_SLOT_HOURS } = require('./bookingSlotHours')
const {
  toMinutes,
  normalizeMinute,
  bookingRowToMinutes,
  rangesOverlap,
} = require('./bookingSlotTimes')

const MIN_GAP_SLOT_MINUTES = 60

function minuteToSlot(startM, endM, baseDurationMinutes) {
  const hour = Math.floor(startM / 60)
  const minute = startM % 60
  const endHour = Math.floor(endM / 60)
  const endMinute = endM % 60
  return {
    startHour: hour,
    startMinute: minute,
    endHour,
    endMinute,
    startM,
    endM,
    baseDurationMinutes,
  }
}

function mergeIntervals(intervals) {
  const sorted = [...intervals]
    .filter((i) => i.endM > i.startM)
    .sort((a, b) => a.startM - b.startM)
  const merged = []
  for (const interval of sorted) {
    const last = merged[merged.length - 1]
    if (!last || interval.startM > last.endM) {
      merged.push({ ...interval })
    } else if (interval.endM > last.endM) {
      last.endM = interval.endM
    }
  }
  return merged
}

function bookingIntervals(bookings, slotHours, excludeBookingId) {
  return (bookings || [])
    .filter((b) => b.status !== 'cancelled' && String(b.id) !== String(excludeBookingId ?? ''))
    .map((b) => bookingRowToMinutes(b, slotHours))
}

function blockIntervals(blocks) {
  const result = []
  for (const block of blocks || []) {
    if (block.is_full_day) {
      return [{ startM: 0, endM: 24 * 60, fullDay: true }]
    }
    if (block.start_hour == null || block.end_hour == null) continue
    result.push({
      startM: Number(block.start_hour) * 60,
      endM: Number(block.end_hour) * 60,
    })
  }
  return result
}

function getTimelineBounds({ dayWindows, openHour, lastBookingHour, slotHours }) {
  const slot = normalizeBookingSlotHours(slotHours)
  const windows = (dayWindows || []).filter(Boolean)
  if (windows.length) {
    return {
      startM: Math.min(...windows.map((w) => toMinutes(Number(w.start_hour), normalizeMinute(w.start_minute)))),
      maxEndM: Math.max(...windows.map((w) => toMinutes(Number(w.end_hour), normalizeMinute(w.end_minute)))),
    }
  }
  const open = Number(openHour)
  const last = Number(lastBookingHour)
  return {
    startM: open * 60,
    maxEndM: (last + slot) * 60,
  }
}

function buildDynamicBookableSlots({
  slotHours = DEFAULT_SLOT_HOURS,
  bookings = [],
  blocks = [],
  dayWindows = [],
  openHour = 9,
  lastBookingHour = 18,
  excludeBookingId = null,
  minGapMinutes = MIN_GAP_SLOT_MINUTES,
}) {
  const slot = normalizeBookingSlotHours(slotHours)
  const slotLenM = slot * 60
  const { startM: timelineStart, maxEndM } = getTimelineBounds({
    dayWindows,
    openHour,
    lastBookingHour,
    slotHours: slot,
  })

  const occupied = mergeIntervals([
    ...bookingIntervals(bookings, slot, excludeBookingId),
    ...blockIntervals(blocks),
  ])

  if (occupied.some((o) => o.fullDay)) return []

  const result = []
  let cursor = timelineStart

  while (cursor < maxEndM) {
    const inside = occupied.find((o) => cursor >= o.startM && cursor < o.endM)
    if (inside) {
      cursor = inside.endM
      continue
    }

    const nextStart = occupied
      .filter((o) => o.startM > cursor)
      .reduce((min, o) => Math.min(min, o.startM), maxEndM)

    const space = nextStart - cursor
    if (space >= slotLenM) {
      result.push(minuteToSlot(cursor, cursor + slotLenM, slotLenM))
      cursor += slotLenM
    } else if (space >= minGapMinutes) {
      result.push(minuteToSlot(cursor, cursor + space, space))
      cursor += space
    } else {
      cursor = nextStart
    }
  }

  return result
}

function buildDynamicTimelineSlots(params) {
  const slot = normalizeBookingSlotHours(params.slotHours)
  const booked = (params.bookings || [])
    .filter((b) => b.status !== 'cancelled' && String(b.id) !== String(params.excludeBookingId ?? ''))
    .map((b) => {
      const { startM, endM } = bookingRowToMinutes(b, slot)
      return minuteToSlot(startM, endM, endM - startM)
    })
  const available = buildDynamicBookableSlots(params)
  const all = [...booked, ...available].sort((a, b) => a.startM - b.startM)
  return { booked, available, all }
}

function matchesDynamicSlotStart(baseSlot, availableSlots) {
  return (availableSlots || []).some(
    (s) => s.startM === baseSlot.startM && (s.startMinute ?? 0) === (baseSlot.startMinute ?? 0)
  )
}

async function fetchBookingsForDynamicSlots(poolOrClient, shopId, bookingDate) {
  const result = await poolOrClient.query(
    `
      SELECT id, start_hour, start_minute, end_hour, end_minute, status
      FROM bookings
      WHERE shop_id = $1 AND booking_date = $2 AND status != 'cancelled'
      ORDER BY start_hour ASC, start_minute ASC
    `,
    [shopId, bookingDate]
  )
  return result.rows
}

async function fetchBlocksForDynamicSlots(poolOrClient, shopId, bookingDate) {
  const result = await poolOrClient.query(
    `
      SELECT start_hour, end_hour, is_full_day
      FROM booking_blocks
      WHERE shop_id = $1 AND block_date = $2
    `,
    [shopId, bookingDate]
  )
  return result.rows
}

async function validateDynamicBookingStart(poolOrClient, shopId, bookingDate, baseSlot, slotHours) {
  const [bookings, blocks, dayWindows, shopHours] = await Promise.all([
    fetchBookingsForDynamicSlots(poolOrClient, shopId, bookingDate),
    fetchBlocksForDynamicSlots(poolOrClient, shopId, bookingDate),
    getDayHoursForDate(poolOrClient, shopId, bookingDate),
    getShopHours(poolOrClient, shopId),
  ])

  const available = buildDynamicBookableSlots({
    slotHours,
    bookings,
    blocks,
    dayWindows,
    openHour: shopHours.openHour,
    lastBookingHour: shopHours.lastBookingHour,
  })

  if (!matchesDynamicSlotStart(baseSlot, available)) {
    return 'ช่วงเวลานี้ไม่เปิดรับจอง (อาจถูกเลื่อนจากคิวก่อนหน้าแล้ว)'
  }
  return null
}

function hasOverlapWithBookings(slot, bookings, slotHours, excludeBookingId) {
  return (bookings || []).some((b) => {
    if (b.status === 'cancelled') return false
    if (String(b.id) === String(excludeBookingId ?? '')) return false
    const existing = bookingRowToMinutes(b, slotHours)
    return rangesOverlap(slot.startM, slot.endM, existing.startM, existing.endM)
  })
}

module.exports = {
  MIN_GAP_SLOT_MINUTES,
  buildDynamicBookableSlots,
  buildDynamicTimelineSlots,
  matchesDynamicSlotStart,
  validateDynamicBookingStart,
  hasOverlapWithBookings,
}
