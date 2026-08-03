const { normalizeBookingSlotHours, DEFAULT_SLOT_HOURS } = require('./bookingSlotHours')

const MAX_MINUTES = 23 * 60 + 59

function toMinutes(hour, minute = 0) {
  return Number(hour) * 60 + Number(minute)
}

function normalizeHm(hour, minute = 0) {
  const h = Number(hour)
  const m = Number(minute)
  if (!Number.isInteger(h) || h < 0 || h > 23) return null
  if (!Number.isInteger(m) || m < 0 || m > 59) return null
  return { hour: h, minute: m }
}

function windowToMinutes(window) {
  const start = normalizeHm(window.start_hour, window.start_minute ?? 0)
  const end = normalizeHm(window.end_hour, window.end_minute ?? 0)
  if (!start || !end) return null
  const startM = toMinutes(start.hour, start.minute)
  const endM = toMinutes(end.hour, end.minute)
  if (startM >= endM || endM > MAX_MINUTES) return null
  return { startM, endM, start, end }
}

function windowsOverlap(a, b) {
  const wa = windowToMinutes(a)
  const wb = windowToMinutes(b)
  if (!wa || !wb) return false
  return wa.startM < wb.endM && wb.startM < wa.endM
}

function getUsedHoursForWindows(windows) {
  const used = new Set()
  for (const window of windows || []) {
    const parsed = windowToMinutes(window)
    if (!parsed) continue
    for (let h = 0; h <= 23; h += 1) {
      const hStart = h * 60
      const hEnd = (h + 1) * 60
      if (hStart < parsed.endM && hEnd > parsed.startM) used.add(h)
    }
  }
  return used
}

function validateDayHourPayload(body, existingWindows, _slotHours = DEFAULT_SLOT_HOURS) {
  const scheduleDate = String(body?.schedule_date || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduleDate)) {
    return { ok: false, error: 'ต้องระบุ schedule_date (YYYY-MM-DD)' }
  }

  const start = normalizeHm(body.start_hour, body.start_minute ?? 0)
  const end = normalizeHm(body.end_hour, body.end_minute ?? 0)
  if (!start || !end) {
    return { ok: false, error: 'เวลาเริ่ม/สิ้นสุดไม่ถูกต้อง' }
  }

  const startM = toMinutes(start.hour, start.minute)
  const endM = toMinutes(end.hour, end.minute)
  if (startM >= endM) {
    return { ok: false, error: 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม' }
  }
  if (endM > MAX_MINUTES) {
    return { ok: false, error: 'เวลาสิ้นสุดต้องไม่เกิน 23:59' }
  }

  const candidate = {
    start_hour: start.hour,
    start_minute: start.minute,
    end_hour: end.hour,
    end_minute: end.minute,
  }
  for (const existing of existingWindows || []) {
    if (windowsOverlap(candidate, existing)) {
      return { ok: false, error: 'ช่วงเวลาทับซ้อนกับรายการที่มีอยู่แล้ว' }
    }
  }

  return {
    ok: true,
    scheduleDate,
    start_hour: start.hour,
    start_minute: start.minute,
    end_hour: end.hour,
    end_minute: end.minute,
  }
}

function isSlotWithinDayWindows(startHour, startMinute, slotHours, dayWindows) {
  const slot = normalizeBookingSlotHours(slotHours)
  const slotStartM = toMinutes(startHour, startMinute ?? 0)
  const slotEndM = slotStartM + slot * 60
  return (dayWindows || []).some((window) => {
    const parsed = windowToMinutes(window)
    if (!parsed) return false
    return slotStartM >= parsed.startM && slotEndM <= parsed.endM
  })
}

function isHourWithinDayWindows(hour, slotHours, dayWindows) {
  return isSlotWithinDayWindows(hour, 0, slotHours, dayWindows)
}

async function getDayHoursForDate(poolOrClient, shopId, date) {
  const result = await poolOrClient.query(
    `
      SELECT id, schedule_date, start_hour, start_minute, end_hour, end_minute, created_at
      FROM booking_day_hours
      WHERE shop_id = $1 AND schedule_date = $2
      ORDER BY start_hour ASC, start_minute ASC
    `,
    [shopId, date]
  )
  return result.rows
}

async function getDayHoursForMonth(poolOrClient, shopId, monthYm) {
  const [y, m] = monthYm.split('-').map(Number)
  if (!y || !m) return []
  const fromDate = new Date(y, m - 1, 1)
  const toDate = new Date(y, m, 0)
  const from = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}-${String(fromDate.getDate()).padStart(2, '0')}`
  const to = `${toDate.getFullYear()}-${String(toDate.getMonth() + 1).padStart(2, '0')}-${String(toDate.getDate()).padStart(2, '0')}`
  const result = await poolOrClient.query(
    `
      SELECT id, schedule_date, start_hour, start_minute, end_hour, end_minute, created_at
      FROM booking_day_hours
      WHERE shop_id = $1 AND schedule_date BETWEEN $2 AND $3
      ORDER BY schedule_date ASC, start_hour ASC, start_minute ASC
    `,
    [shopId, from, to]
  )
  return result.rows
}

module.exports = {
  MAX_MINUTES,
  toMinutes,
  normalizeHm,
  windowToMinutes,
  windowsOverlap,
  getUsedHoursForWindows,
  validateDayHourPayload,
  isHourWithinDayWindows,
  getDayHoursForDate,
  getDayHoursForMonth,
}
