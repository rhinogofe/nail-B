const { getLinePushSettings, DEFAULT_TEMPLATE } = require('./linePushSettings')
const { pushLineMessage } = require('./linePush')

const STATUS_LABELS = {
  awaiting_payment: 'รอชำระเงิน',
  pending: 'รอให้บริการ',
  done: 'ทำเสร็จแล้ว',
  cancelled: 'ยกเลิก',
}

function padHour(hour) {
  return `${Number(hour)}:00`
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
        b.end_hour,
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
  const endHour = row.end_hour ?? Number(row.start_hour) + 2
  const customer = row.customer_name
    || row.customer_phone
    || row.customer_email
    || 'ลูกค้า'

  return {
    bookingId: row.id,
    shop: row.shop_name,
    customer,
    date: formatThaiDate(row.booking_date),
    start: padHour(row.start_hour),
    end: padHour(endHour),
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
