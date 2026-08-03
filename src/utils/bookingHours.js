const { getShopSettings } = require('./shopSettings')
const { normalizeBookingSlotHours, DEFAULT_SLOT_HOURS } = require('./bookingSlotHours')
const { getDayHoursForDate } = require('./bookingDayHours')
const {
  normalizeSlotInput,
  matchesDayWindowSlot,
} = require('./bookingSlotTimes')

async function getShopHours(pool, shopId) {
  const map = await getShopSettings(pool, shopId, [
    'shop_open_hour',
    'shop_last_booking_hour',
    'booking_slot_hours',
  ])
  const slotHours = normalizeBookingSlotHours(map.booking_slot_hours)
  const openHour = Number.isInteger(Number(map.shop_open_hour)) && Number(map.shop_open_hour) >= 1 && Number(map.shop_open_hour) <= 20
    ? Number(map.shop_open_hour)
    : 9
  const lastRaw = Number(map.shop_last_booking_hour)
  const minLast = openHour + slotHours
  const lastBookingHour = Number.isInteger(lastRaw) && lastRaw >= minLast && lastRaw <= 22
    ? lastRaw
    : Math.max(minLast, 18)
  return {
    openHour,
    lastBookingHour,
    slotHours,
  }
}

async function getExtraHoursForDate(poolOrClient, shopId, date) {
  const result = await poolOrClient.query(
    `
      SELECT id, extra_date, start_hour, end_hour, note
      FROM booking_extra_hours
      WHERE shop_id = $1 AND extra_date = $2
      ORDER BY start_hour ASC
    `,
    [shopId, date]
  )
  return result.rows
}

function isWithinExtraWindow(startHour, duration, extras) {
  return extras.some(
    (e) => startHour >= Number(e.start_hour) && startHour + duration <= Number(e.end_hour)
  )
}

function isWithinNormalHours(startHour, openHour, lastBookingHour) {
  return startHour >= openHour && startHour <= lastBookingHour
}

async function validateBookingStartHour(poolOrClient, shopId, bookingDate, startHour, duration = DEFAULT_SLOT_HOURS) {
  const slotHours = normalizeBookingSlotHours(duration)
  const dayWindows = await getDayHoursForDate(poolOrClient, shopId, bookingDate)
  if (dayWindows.length) {
    return 'วันนี้ใช้เวลาเปิด-ปิดเฉพาะวัน กรุณาเลือกช่วงเวลาที่ตั้งไว้'
  }

  const { openHour, lastBookingHour } = await getShopHours(poolOrClient, shopId)
  if (isWithinNormalHours(startHour, openHour, lastBookingHour)) {
    return null
  }
  const extras = await getExtraHoursForDate(poolOrClient, shopId, bookingDate)
  if (isWithinExtraWindow(startHour, slotHours, extras)) {
    return null
  }
  return `start_hour ต้องอยู่ระหว่าง ${openHour}-${lastBookingHour} หรือในช่วงเปิดเพิ่มของวันนี้`
}

async function validateBookingSlot(poolOrClient, shopId, bookingDate, body, slotHours = DEFAULT_SLOT_HOURS) {
  const slot = normalizeSlotInput(body, slotHours)
  if (!slot) return 'ช่วงเวลาไม่ถูกต้อง'

  const dayWindows = await getDayHoursForDate(poolOrClient, shopId, bookingDate)
  if (dayWindows.length) {
    if (!matchesDayWindowSlot(slot, dayWindows)) {
      return 'ช่วงเวลานี้ไม่ตรงกับเวลาที่เปิดรับวันนี้'
    }
    return null
  }

  if (slot.startMinute !== 0 || slot.endMinute !== 0) {
    return 'วันนี้ใช้เวลาเปิด-ปิดปกติ (เต็มชั่วโมง)'
  }

  const hourError = await validateBookingStartHour(
    poolOrClient,
    shopId,
    bookingDate,
    slot.startHour,
    slotHours
  )
  if (hourError) return hourError

  const expectedEndHour = slot.startHour + normalizeBookingSlotHours(slotHours)
  if (slot.endHour !== expectedEndHour || slot.endMinute !== 0) {
    return `ช่วงเวลาต้องยาว ${normalizeBookingSlotHours(slotHours)} ชั่วโมง`
  }
  return null
}

module.exports = {
  getShopHours,
  getExtraHoursForDate,
  getDayHoursForDate,
  isWithinExtraWindow,
  isWithinNormalHours,
  validateBookingStartHour,
  validateBookingSlot,
}
