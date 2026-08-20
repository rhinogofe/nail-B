const router = require('express').Router()
const { getPool } = require('../db/pool')
const {
  parseBase64Image,
  saveBookingPaymentSlip,
  deleteBookingPaymentSlip,
  readBookingPaymentSlip,
  mapSlipRow,
  MIME_EXT,
} = require('../utils/bookingPaymentSlips')
const { getBookingSlipRetentionDays } = require('../utils/bookingPaymentSlipSettings')
const { getUnpaidExpireSettings, isBookingExpired, expireUnpaidBookings } = require('../utils/unpaidExpire')
const { notifyBookingPaidChat } = require('../utils/bookingChatNotify')
const { emitBookingChanged } = require('../utils/bookingEvents')

const SLIP_LIST_SQL = `
  SELECT
    bps.*,
    b.booking_date,
    b.start_hour,
    b.start_minute,
    b.end_hour,
    b.end_minute,
    b.status AS booking_status,
    u.name AS user_name,
    u.email AS user_email
  FROM booking_payment_slips bps
  JOIN bookings b ON b.id = bps.booking_id
  JOIN users u ON u.id = b.user_id
`

async function fetchSlipById(pool, id, shopId) {
  const result = await pool.query(
    `${SLIP_LIST_SQL} WHERE bps.id = $1 AND bps.shop_id = $2 LIMIT 1`,
    [id, shopId]
  )
  return result.rows[0] || null
}

async function confirmBookingPayment(pool, shopId, bookingId, reviewerUserId) {
  await expireUnpaidBookings(pool, shopId)
  const settings = await getUnpaidExpireSettings(pool, shopId)

  const found = await pool.query(
    `SELECT id, status, created_at, booking_date FROM bookings WHERE id = $1 AND shop_id = $2`,
    [bookingId, shopId]
  )
  const row = found.rows[0]
  if (!row || row.status !== 'awaiting_payment') {
    return { error: 'ไม่พบคิวที่รอยืนยันชำระเงิน', status: 404 }
  }

  if (isBookingExpired(row.created_at, settings.expireHours, settings.enabled)) {
    await pool.query(
      `UPDATE bookings SET status = 'cancelled' WHERE id = $1 AND shop_id = $2 AND status = 'awaiting_payment'`,
      [bookingId, shopId]
    )
    const { deletePaymentSlipByBookingId } = require('../utils/bookingPaymentSlips')
    await deletePaymentSlipByBookingId(pool, bookingId)
    emitBookingChanged(shopId, {
      type: 'auto_cancelled',
      booking_id: row.id,
      booking_date: row.booking_date,
    })
    return { error: 'คิวหมดเวลาชำระแล้ว ถูกยกเลิกอัตโนมัติ', status: 409 }
  }

  const result = await pool.query(
    `
      UPDATE bookings
      SET status = 'pending'
      WHERE id = $1 AND shop_id = $2 AND status = 'awaiting_payment'
      RETURNING id, booking_date
    `,
    [bookingId, shopId]
  )

  if (result.rowCount === 0) {
    return { error: 'ไม่พบคิวที่รอยืนยันชำระเงิน', status: 404 }
  }

  emitBookingChanged(shopId, {
    type: 'payment_confirmed',
    booking_id: result.rows[0].id,
    booking_date: result.rows[0].booking_date,
  })
  notifyBookingPaidChat(pool, shopId, bookingId).catch(() => null)
  return { success: true, booking: result.rows[0], reviewerUserId }
}

router.get('/', async (req, res) => {
  try {
    const pool = getPool()
    const shopId = req.shop.id
    const retentionDays = await getBookingSlipRetentionDays(pool, shopId)
    const bookingDate = String(req.query.booking_date || '').trim()
    const params = [shopId, retentionDays]
    let dateClause = ''
    if (/^\d{4}-\d{2}-\d{2}$/.test(bookingDate)) {
      params.push(bookingDate)
      dateClause = `AND b.booking_date = $${params.length}`
    }
    const result = await pool.query(
      `
        ${SLIP_LIST_SQL}
        WHERE bps.shop_id = $1
          AND bps.created_at >= NOW() - ($2::int * INTERVAL '1 day')
          ${dateClause}
        ORDER BY
          CASE bps.status WHEN 'pending' THEN 0 WHEN 'cancelled' THEN 1 ELSE 2 END,
          bps.created_at DESC
      `,
      params
    )
    res.json({
      retention_days: retentionDays,
      slips: result.rows.map(mapSlipRow),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/files/:filename', async (req, res) => {
  try {
    const pool = getPool()
    const filename = String(req.params.filename || '').trim()
    const owned = await pool.query(
      `
        SELECT bps.shop_id
        FROM booking_payment_slips bps
        WHERE bps.slip_filename = $1
        LIMIT 1
      `,
      [filename]
    )
    const row = owned.rows[0]
    if (!row || row.shop_id !== req.shop.id) {
      return res.status(404).json({ error: 'ไม่พบสลิป' })
    }

    const buffer = await readBookingPaymentSlip(filename)
    if (!buffer) return res.status(404).json({ error: 'ไม่พบไฟล์สลิป' })

    const ext = filename.split('.').pop()?.toLowerCase()
    const mime = Object.entries(MIME_EXT).find(([, v]) => v === ext)?.[0] || 'image/jpeg'
    res.set('Cache-Control', 'private, max-age=3600')
    res.type(mime)
    res.send(buffer)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.patch('/:id/confirm', async (req, res) => {
  try {
    const pool = getPool()
    const slip = await fetchSlipById(pool, req.params.id, req.shop.id)
    if (!slip) return res.status(404).json({ error: 'ไม่พบสลิป' })
    if (slip.status !== 'pending') {
      return res.status(400).json({ error: 'สลิปนี้ไม่อยู่ในสถานะรอตรวจ' })
    }

    const paymentResult = await confirmBookingPayment(pool, req.shop.id, slip.booking_id, req.user.id)
    if (paymentResult.error) {
      return res.status(paymentResult.status || 400).json({ error: paymentResult.error })
    }

    await pool.query(
      `
        UPDATE booking_payment_slips
        SET status = 'confirmed', reviewed_by_user_id = $1, reviewed_at = NOW(), updated_at = NOW()
        WHERE id = $2
      `,
      [req.user.id, slip.id]
    )

    const updated = await fetchSlipById(pool, slip.id, req.shop.id)
    res.json({
      success: true,
      message: 'ยืนยันชำระเงินแล้ว',
      slip: mapSlipRow(updated),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.patch('/:id/cancel', async (req, res) => {
  try {
    const pool = getPool()
    const slip = await fetchSlipById(pool, req.params.id, req.shop.id)
    if (!slip) return res.status(404).json({ error: 'ไม่พบสลิป' })
    if (slip.status !== 'pending') {
      return res.status(400).json({ error: 'ยกเลิกได้เฉพาะสลิปที่รอตรวจ' })
    }

    await pool.query(
      `
        UPDATE booking_payment_slips
        SET status = 'cancelled', reviewed_by_user_id = $1, reviewed_at = NOW(), updated_at = NOW()
        WHERE id = $2
      `,
      [req.user.id, slip.id]
    )

    const updated = await fetchSlipById(pool, slip.id, req.shop.id)
    res.json({ success: true, message: 'ยกเลิกสลิปแล้ว', slip: mapSlipRow(updated) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    const pool = getPool()
    const slip = await fetchSlipById(pool, req.params.id, req.shop.id)
    if (!slip) return res.status(404).json({ error: 'ไม่พบสลิป' })
    if (slip.status !== 'cancelled') {
      return res.status(400).json({ error: 'ลบได้เฉพาะสลิปที่ยกเลิกแล้ว' })
    }

    await pool.query(`DELETE FROM booking_payment_slips WHERE id = $1`, [slip.id])
    await deleteBookingPaymentSlip(slip.slip_filename)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
