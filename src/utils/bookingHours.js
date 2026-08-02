const { getShopSettings } = require('./shopSettings')

async function getShopHours(pool, shopId) {
  const map = await getShopSettings(pool, shopId, ['shop_open_hour', 'shop_last_booking_hour'])
  const openHour = Number.isInteger(Number(map.shop_open_hour)) && Number(map.shop_open_hour) >= 1 && Number(map.shop_open_hour) <= 20
    ? Number(map.shop_open_hour)
    : 9
  const lastRaw = Number(map.shop_last_booking_hour)
  const lastBookingHour = Number.isInteger(lastRaw) && lastRaw >= openHour + 2 && lastRaw <= 22
    ? lastRaw
    : Math.max(openHour + 2, 18)
  return {
    openHour,
    lastBookingHour,
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

async function validateBookingStartHour(poolOrClient, shopId, bookingDate, startHour, duration = 2) {
  const { openHour, lastBookingHour } = await getShopHours(poolOrClient, shopId)
  if (isWithinNormalHours(startHour, openHour, lastBookingHour)) {
    return null
  }
  const extras = await getExtraHoursForDate(poolOrClient, shopId, bookingDate)
  if (isWithinExtraWindow(startHour, duration, extras)) {
    return null
  }
  return `start_hour ต้องอยู่ระหว่าง ${openHour}-${lastBookingHour} หรือในช่วงเปิดเพิ่มของวันนี้`
}

module.exports = {
  getShopHours,
  getExtraHoursForDate,
  isWithinExtraWindow,
  isWithinNormalHours,
  validateBookingStartHour,
}
