const router = require('express').Router()
const auth   = require('../middleware/authMiddleware')
const { getPool } = require('../db/pool')
const { getAdvanceSettings, validateBookingDateRange } = require('../utils/bookingWindow')
const {
  syncBookingOptions,
  validateOptionIds,
  validateRequiredOptions,
} = require('../utils/bookingOptions')
const { getShopHours, validateBookingStartHour } = require('../utils/bookingHours')
const {
  getUnpaidExpireSettings,
  isBookingExpired,
  expireUnpaidBookings,
} = require('../utils/unpaidExpire')

router.get('/shop-hours', auth, async (req, res) => {
  try {
    const pool = getPool()
    const hours = await getShopHours(pool)
    res.json({ open_hour: hours.openHour, last_booking_hour: hours.lastBookingHour })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/advance-days', auth, async (req, res) => {
  try {
    const pool = getPool()
    const settings = await getAdvanceSettings(pool)
    res.json({
      advance_days: settings.advanceDays,
      book_until_date: settings.bookUntilDate,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/booking-display', auth, async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.query(
      `SELECT setting_value FROM app_settings WHERE setting_key = 'booking_display_mode'`
    )
    const mode = result.rows[0]?.setting_value === 'slots_2h' ? 'slots_2h' : 'normal'
    res.json({ display_mode: mode })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/deposit-setting', auth, async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.query(
      `SELECT setting_value FROM app_settings WHERE setting_key = 'deposit_amount'`
    )
    const value = result.rows[0]?.setting_value || '300'
    res.json({ deposit_amount: Number(value) || 300 })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/unpaid-expire-setting', auth, async (req, res) => {
  try {
    const pool = getPool()
    const settings = await getUnpaidExpireSettings(pool)
    res.json({
      enabled: settings.enabled,
      expire_hours: settings.expireHours,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/options', auth, async (req, res) => {
  const { date } = req.query
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    return res.status(400).json({ error: 'date ต้องเป็น YYYY-MM-DD' })
  }

  try {
    const pool = getPool()
    const params = []
    let dateFilter = ''
    if (date) {
      params.push(String(date))
      dateFilter = `
        AND (show_from_date IS NULL OR show_from_date <= $${params.length})
        AND (show_to_date IS NULL OR show_to_date >= $${params.length})
      `
    }

    const result = await pool.query(
      `
        SELECT id, option_name, description, price, duration_min, is_active, is_required, color,
               show_from_date, show_to_date
        FROM nailoption
        WHERE is_active = true
        ${dateFilter}
        ORDER BY sort_order ASC, option_name ASC
      `,
      params
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/', auth, async (req, res) => {
  const { date } = req.query
  if (!date) return res.status(400).json({ error: 'ต้องระบุ date (YYYY-MM-DD)' })

  try {
    const pool = getPool()
    await expireUnpaidBookings(pool)
    const result = await pool.query(
      `
        SELECT
          b.id,
          b.start_hour,
          b.end_hour,
          b.status,
          b.created_at,
          u.name        AS user_name,
          u.avatar_url  AS user_avatar,
          CASE WHEN b.user_id = $2 THEN true ELSE false END AS is_mine
        FROM bookings b
        JOIN users u ON u.id = b.user_id
        WHERE b.booking_date = $1
          AND b.status != 'cancelled'
        ORDER BY b.start_hour
      `,
      [date, req.user.id]
    )

    const blocks = await pool.query(
      `
        SELECT id, block_date, start_hour, end_hour, is_full_day, note
        FROM booking_blocks
        WHERE block_date = $1
        ORDER BY is_full_day DESC, start_hour ASC
      `,
      [date]
    )

    res.json({
      bookings: result.rows,
      blocks: blocks.rows,
      is_closed_day: blocks.rows.some((b) => b.is_full_day),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/blocks', auth, async (req, res) => {
  const { from, to } = req.query
  if (!from || !to) return res.status(400).json({ error: 'ต้องระบุ from และ to' })

  try {
    const pool = getPool()
    const result = await pool.query(
      `
        SELECT id, block_date, start_hour, end_hour, is_full_day, note
        FROM booking_blocks
        WHERE block_date BETWEEN $1 AND $2
        ORDER BY block_date ASC, is_full_day DESC, start_hour ASC
      `,
      [from, to]
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/extra-hours', auth, async (req, res) => {
  const { from, to } = req.query
  if (!from || !to) return res.status(400).json({ error: 'ต้องระบุ from และ to' })

  try {
    const pool = getPool()
    const result = await pool.query(
      `
        SELECT id, extra_date, start_hour, end_hour, note
        FROM booking_extra_hours
        WHERE extra_date BETWEEN $1 AND $2
        ORDER BY extra_date ASC, start_hour ASC
      `,
      [from, to]
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/', auth, async (req, res) => {
  const { booking_date, start_hour, option_ids } = req.body
  if (!booking_date || start_hour == null)
    return res.status(400).json({ error: 'ต้องระบุ booking_date และ start_hour' })
  if (!Array.isArray(option_ids) || option_ids.length === 0) {
    return res.status(400).json({ error: 'กรุณาเลือกบริการอย่างน้อย 1 รายการ' })
  }

  try {
    const pool = getPool()
    await expireUnpaidBookings(pool)
    const { bookUntilDate } = await getAdvanceSettings(pool)
    const dateError = validateBookingDateRange(booking_date, bookUntilDate)
    if (dateError) return res.status(400).json({ error: dateError })

    const hourError = await validateBookingStartHour(pool, booking_date, start_hour)
    if (hourError) return res.status(400).json({ error: hourError })

    const uniqueOptionIds = [...new Set(option_ids.map(String))]
    const isValidOptions = await validateOptionIds(pool, uniqueOptionIds, booking_date)
    if (!isValidOptions) {
      return res.status(400).json({ error: 'รายการบริการที่เลือกไม่ถูกต้อง' })
    }

    const requiredError = await validateRequiredOptions(pool, uniqueOptionIds, booking_date)
    if (requiredError) {
      return res.status(400).json({ error: requiredError })
    }

    const overlap = await pool.query(
      `
        SELECT id
        FROM bookings
        WHERE booking_date = $1
          AND status != 'cancelled'
          AND start_hour < $3
          AND COALESCE(end_hour, start_hour + 2) > $2
        LIMIT 1
      `,
      [booking_date, start_hour, start_hour + 2]
    )

    if (overlap.rows.length > 0) {
      return res.status(409).json({ error: 'เวลานี้ทับกับคิวอื่น กรุณาเลือกเวลาใหม่' })
    }

    const blocked = await pool.query(
      `
        SELECT id
        FROM booking_blocks
        WHERE block_date = $1
          AND (
            is_full_day = true
            OR (start_hour < $3 AND end_hour > $2)
          )
        LIMIT 1
      `,
      [booking_date, start_hour, start_hour + 2]
    )

    if (blocked.rows.length > 0) {
      return res.status(409).json({ error: 'ช่วงเวลานี้ร้านปิดรับคิว' })
    }

    const result = await pool.query(
      `
        INSERT INTO bookings (user_id, booking_date, start_hour, end_hour, status)
        VALUES ($1, $2, $3, $4, 'awaiting_payment')
        RETURNING id, booking_date, start_hour, end_hour, status
      `,
      [req.user.id, booking_date, start_hour, start_hour + 2]
    )
    await syncBookingOptions(pool, result.rows[0].id, uniqueOptionIds)
    res.status(201).json({ success: true, booking: result.rows[0] })
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'เวลานี้ถูกจองแล้ว กรุณาเลือกเวลาอื่น' })
    }
    res.status(500).json({ error: err.message })
  }
})

router.get('/:id/payment-info', auth, async (req, res) => {
  try {
    const pool = getPool()
    await expireUnpaidBookings(pool)
    const settings = await getUnpaidExpireSettings(pool)

    const result = await pool.query(
      `
        SELECT id, booking_date, start_hour, end_hour, status, created_at
        FROM bookings
        WHERE id = $1 AND user_id = $2
      `,
      [req.params.id, req.user.id]
    )

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'ไม่พบคิว' })
    }

    const booking = result.rows[0]
    const expired = isBookingExpired(booking.created_at, settings.expireHours, settings.enabled)

    if (expired && booking.status === 'awaiting_payment') {
      await pool.query(
        `UPDATE bookings SET status = 'cancelled' WHERE id = $1 AND status = 'awaiting_payment'`,
        [booking.id]
      )
      booking.status = 'cancelled'
    }

    res.json({
      booking,
      unpaid_expire: {
        enabled: settings.enabled,
        expire_hours: settings.expireHours,
      },
      is_expired: booking.status === 'cancelled' && expired,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/:id', auth, async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.query(
      `
        UPDATE bookings
        SET status = 'cancelled'
        WHERE id = $1
          AND user_id = $2
          AND status = 'awaiting_payment'
      `,
      [req.params.id, req.user.id]
    )

    if (result.rowCount === 0)
      return res.status(404).json({ error: 'ไม่พบคิว หรือไม่สามารถยกเลิกได้' })

    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/my', auth, async (req, res) => {
  try {
    const pool = getPool()
    await expireUnpaidBookings(pool)
    const result = await pool.query(
      `
        SELECT
          b.id,
          b.booking_date,
          b.start_hour,
          b.end_hour,
          b.status,
          b.created_at,
          b.completed_at,
          b.total
        FROM bookings b
        WHERE b.user_id = $1
        ORDER BY b.booking_date DESC, b.start_hour DESC
      `,
      [req.user.id]
    )

    const optionsResult = await pool.query(
      `
        SELECT b.id AS booking_id, n.id AS option_id, n.option_name
        FROM bookings b
        JOIN booking_nailoptions bn ON bn.booking_id = b.id
        JOIN nailoption n ON n.id = bn.nailoption_id
        WHERE b.user_id = $1
        ORDER BY b.booking_date DESC, b.start_hour DESC, n.option_name ASC
      `,
      [req.user.id]
    )

    const optionsByBookingId = {}
    for (const row of optionsResult.rows) {
      if (!optionsByBookingId[row.booking_id]) optionsByBookingId[row.booking_id] = []
      optionsByBookingId[row.booking_id].push({
        id: row.option_id,
        option_name: row.option_name,
      })
    }

    res.json(result.rows.map((item) => ({
      ...item,
      nail_options: optionsByBookingId[item.id] || [],
    })))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
