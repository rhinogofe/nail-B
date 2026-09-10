const { getShopSettings, setShopSetting, setShopSettings } = require('./shopSettings')

const BANGKOK_TZ = 'Asia/Bangkok'
const EXTEND_SETTING_KEY = 'book_advance_extend_enabled'

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

function parseExtendEnabled(value, fallback = true) {
  if (value == null || value === '') return fallback
  const v = String(value).trim().toLowerCase()
  if (v === '1' || v === 'true' || v === 'yes') return true
  if (v === '0' || v === 'false' || v === 'no') return false
  return fallback
}

async function getAdvanceSettings(pool, shopId) {
  const map = await getShopSettings(pool, shopId, [
    'book_advance_days',
    'book_until_date',
    EXTEND_SETTING_KEY,
  ])
  const advanceDays = Number(map.book_advance_days || 30)
  const extendEnabled = parseExtendEnabled(map[EXTEND_SETTING_KEY], true)

  let bookUntilDate = map.book_until_date || null
  if (extendEnabled) {
    bookUntilDate = computeBookUntilDate(advanceDays)
  } else if (!bookUntilDate || !/^\d{4}-\d{2}-\d{2}$/.test(bookUntilDate)) {
    bookUntilDate = computeBookUntilDate(advanceDays)
    await setShopSetting(pool, shopId, 'book_until_date', bookUntilDate)
  }

  return { advanceDays, bookUntilDate, extendEnabled }
}

async function setAdvanceSettings(pool, shopId, { advanceDays, extendEnabled } = {}) {
  const current = await getAdvanceSettings(pool, shopId)
  const days = advanceDays != null ? Number(advanceDays) : current.advanceDays
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    const err = new Error('advance_days ต้องอยู่ระหว่าง 1-365')
    err.status = 400
    throw err
  }

  const extend = extendEnabled != null
    ? Boolean(extendEnabled)
    : current.extendEnabled

  const entries = {
    book_advance_days: String(days),
    [EXTEND_SETTING_KEY]: extend ? 'true' : 'false',
  }

  // Always refresh locked end-date when saving days, or when turning extend off
  // (freeze at today's rolling window). When extend stays on, keep date in sync too.
  entries.book_until_date = computeBookUntilDate(days, todayYmdBangkok())

  await setShopSettings(pool, shopId, entries)
  return {
    advanceDays: days,
    bookUntilDate: entries.book_until_date,
    extendEnabled: extend,
  }
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
  EXTEND_SETTING_KEY,
  todayYmdBangkok,
  addDaysToYmd,
  computeBookUntilDate,
  parseExtendEnabled,
  getAdvanceSettings,
  setAdvanceSettings,
  validateBookingDateRange,
}
