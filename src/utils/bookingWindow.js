const BANGKOK_TZ = 'Asia/Bangkok'

function todayYmdBangkok() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BANGKOK_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function addDaysToYmd(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

function computeBookUntilDate(advanceDays, fromYmd = todayYmdBangkok()) {
  const days = Number(advanceDays)
  if (!Number.isInteger(days) || days < 1) return fromYmd
  return addDaysToYmd(fromYmd, days - 1)
}

async function getAdvanceSettings(pool) {
  const result = await pool.query(
    `SELECT setting_key, setting_value FROM app_settings
     WHERE setting_key IN ('book_advance_days', 'book_until_date')`
  )
  const map = Object.fromEntries(result.rows.map((row) => [row.setting_key, row.setting_value]))
  const advanceDays = Number(map.book_advance_days || 30)
  let bookUntilDate = map.book_until_date || null
  if (!bookUntilDate || !/^\d{4}-\d{2}-\d{2}$/.test(bookUntilDate)) {
    bookUntilDate = computeBookUntilDate(advanceDays)
  }
  return { advanceDays, bookUntilDate }
}

function validateBookingDateRange(bookingDate, bookUntilDate, todayYmd = todayYmdBangkok()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(bookingDate))) {
    return 'รูปแบบวันที่ไม่ถูกต้อง'
  }
  if (bookingDate < todayYmd) {
    return 'ไม่สามารถจองวันที่ผ่านมาแล้ว'
  }
  if (bookingDate > bookUntilDate) {
    return `จองได้ถึงวันที่ ${bookUntilDate} เท่านั้น`
  }
  return null
}

module.exports = {
  todayYmdBangkok,
  addDaysToYmd,
  computeBookUntilDate,
  getAdvanceSettings,
  validateBookingDateRange,
}
