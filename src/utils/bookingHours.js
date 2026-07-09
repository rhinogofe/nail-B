async function getShopHours(pool) {
  const result = await pool.query(
    `SELECT setting_key, setting_value FROM app_settings
     WHERE setting_key IN ('shop_open_hour', 'shop_last_booking_hour')`
  )
  const map = Object.fromEntries(result.rows.map((r) => [r.setting_key, Number(r.setting_value)]))
  const openHour = Number.isInteger(map.shop_open_hour) && map.shop_open_hour >= 1 && map.shop_open_hour <= 20
    ? map.shop_open_hour
    : 9
  const lastRaw = map.shop_last_booking_hour
  const lastBookingHour = Number.isInteger(lastRaw) && lastRaw >= openHour + 2 && lastRaw <= 22
    ? lastRaw
    : Math.max(openHour + 2, 18)
  return {
    openHour,
    lastBookingHour,
  }
}

async function getExtraHoursForDate(poolOrClient, date) {
  const result = await poolOrClient.query(
    `
      SELECT id, extra_date, start_hour, end_hour, note
      FROM booking_extra_hours
      WHERE extra_date = $1
      ORDER BY start_hour ASC
    `,
    [date]
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

async function validateBookingStartHour(poolOrClient, bookingDate, startHour, duration = 2) {
  const { openHour, lastBookingHour } = await getShopHours(poolOrClient)
  if (isWithinNormalHours(startHour, openHour, lastBookingHour)) {
    return null
  }
  const extras = await getExtraHoursForDate(poolOrClient, bookingDate)
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
