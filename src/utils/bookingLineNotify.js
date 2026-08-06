const { getBookingSlotHours, bookingEndHour } = require('./bookingSlotHours')
const { getLinePushSettings, DEFAULT_TEMPLATE } = require('./linePushSettings')
const { pushLineMessage } = require('./linePush')

const STATUS_LABELS = {
  awaiting_payment: 'รอชำระเงิน',
  pending: 'รอให้บริการ',
  done: 'ทำเสร็จแล้ว',
  cancelled: 'ยกเลิก',
}

function formatHmLabel(hour, minute = 0) {
  const h = Number(hour)
  const m = Number(minute ?? 0)
  if (!Number.isInteger(h) || h < 0 || h > 23) return `${hour}:00`
  const min = Number.isInteger(m) && m >= 0 && m <= 59 ? m : 0
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

function formatThaiDate(isoDate) {
  if (!isoDate) return '-'
  const [y, m, d] = String(isoDate).split('-').map(Number)
  if (!y || !m || !d) return String(isoDate)
  return `${d}/${m}/${y + 543}`
}

function applyTemplate(template, vars) {
  return String(template || DEFAULT_TEMPLATE).replace(/\{(\w+)\}/g, (_, key) => {
    if (vars[key] == null) return ''
    return String(vars[key])
  })
}

async function loadBookingNotifyContext(poolOrClient, shopId, bookingId) {
  const result = await poolOrClient.query(
    `
      SELECT
        b.id,
        b.booking_date,
        b.start_hour,
        b.start_minute,
        b.end_hour,
        b.end_minute,
        b.status,
        u.name AS customer_name,
        u.email AS customer_email,
        u.provider_id AS customer_phone,
        s.name AS shop_name
      FROM bookings b
      JOIN users u ON u.id = b.user_id
      JOIN shops s ON s.id = b.shop_id
      WHERE b.id = $1 AND b.shop_id = $2
    `,
    [bookingId, shopId]
  )
  const row = result.rows[0]
  if (!row) return null

  const optionsRes = await poolOrClient.query(
    `
      SELECT n.option_name
      FROM booking_nailoptions bn
      JOIN nailoption n ON n.id = bn.nailoption_id
      WHERE bn.booking_id = $1
      ORDER BY n.sort_order ASC, n.option_name ASC
    `,
    [bookingId]
  )
  const services = optionsRes.rows.map((r) => r.option_name).join(', ') || '-'
  const slotHours = await getBookingSlotHours(poolOrClient, shopId)
  const endHour = row.end_hour ?? bookingEndHour(row.start_hour, slotHours)
  const endMinute = row.end_minute ?? 0
  const customer = row.customer_name
    || row.customer_phone
    || row.customer_email
    || 'ลูกค้า'

  return {
    bookingId: row.id,
    shop: row.shop_name,
    customer,
    date: formatThaiDate(row.booking_date),
    start: formatHmLabel(row.start_hour, row.start_minute),
    end: formatHmLabel(endHour, endMinute),
    services,
    status: STATUS_LABELS[row.status] || row.status,
  }
}

async function notifyShopNewBooking(poolOrClient, shopId, bookingId, { test = false, testMessage = null } = {}) {
  try {
    const settings = await getLinePushSettings(poolOrClient, shopId, { includeToken: true })
    if (!test && !settings.pushEnabledFlag) {
      return { ok: false, skipped: true, reason: 'disabled' }
    }
    const token = settings.channelAccessToken
    const toId = settings.pushToId
    if (!token || !toId) {
      return { ok: false, skipped: true, reason: 'missing_config' }
    }

    let text = testMessage
    if (!text) {
      const ctx = await loadBookingNotifyContext(poolOrClient, shopId, bookingId)
      if (!ctx) return { ok: false, skipped: true, reason: 'booking_not_found' }
      text = applyTemplate(settings.notifyTemplate, ctx)
    }

    const result = await pushLineMessage({
      channelAccessToken: token,
      toId,
      text,
    })
    if (!result.ok && !result.skipped) {
      console.error('LINE push failed:', result.status, result.error)
    }
    return result
  } catch (err) {
    console.error('notifyShopNewBooking:', err.message)
    return { ok: false, error: err.message }
  }
}

module.exports = {
  notifyShopNewBooking,
  loadBookingNotifyContext,
  applyTemplate,
  DEFAULT_TEMPLATE: DEFAULT_TEMPLATE,
}
