const router = require('express').Router()
const auth   = require('../middleware/authMiddleware')
const { getPool } = require('../db/pool')

async function syncBookingOptions(pool, bookingId, optionIds) {
  await pool.query(`DELETE FROM booking_nailoptions WHERE booking_id = $1`, [bookingId])

  if (!optionIds.length) return

  const values = []
  const params = [bookingId]
  optionIds.forEach((id, idx) => {
    params.push(id)
    values.push(`($1, $${idx + 2})`)
  })

  await pool.query(
    `INSERT INTO booking_nailoptions (booking_id, nailoption_id) VALUES ${values.join(', ')}`,
    params
  )
}

async function validateOptionIds(pool, optionIds, bookingDate) {
  const placeholders = optionIds.map((_, idx) => `$${idx + 1}`).join(', ')
  const dateParam = bookingDate ? `$${optionIds.length + 1}` : null
  const dateFilter = bookingDate
    ? `
      AND (show_from_date IS NULL OR show_from_date <= ${dateParam})
      AND (show_to_date IS NULL OR show_to_date >= ${dateParam})
    `
    : ''
  const params = bookingDate ? [...optionIds, bookingDate] : optionIds
  const result = await pool.query(
    `SELECT id FROM nailoption WHERE is_active = true AND id IN (${placeholders}) ${dateFilter}`,
    params
  )
  return result.rows.length === optionIds.length
}

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
        SELECT id, option_name, description, price, duration_min, is_active,
               show_from_date, show_to_date
        FROM nailoption
        WHERE is_active = true
        ${dateFilter}
        ORDER BY
          CASE WHEN description IS NULL OR TRIM(description) = '' THEN 1 ELSE 0 END,
          description ASC,
          option_name ASC
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
    const result = await pool.query(
      `
        SELECT
          b.id,
          b.start_hour,
          b.end_hour,
          b.status,
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

router.post('/', auth, async (req, res) => {
  const { booking_date, start_hour, option_ids } = req.body
  if (!booking_date || start_hour == null)
    return res.status(400).json({ error: 'ต้องระบุ booking_date และ start_hour' })
  if (start_hour < 9 || start_hour > 18)
    return res.status(400).json({ error: 'start_hour ต้องอยู่ระหว่าง 9-18' })
  if (!Array.isArray(option_ids) || option_ids.length === 0) {
    return res.status(400).json({ error: 'กรุณาเลือกบริการอย่างน้อย 1 รายการ' })
  }

  try {
    const pool = getPool()
    const uniqueOptionIds = [...new Set(option_ids)]
    const isValidOptions = await validateOptionIds(pool, uniqueOptionIds, booking_date)
    if (!isValidOptions) {
      return res.status(400).json({ error: 'รายการบริการที่เลือกไม่ถูกต้อง' })
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

    const reused = await pool.query(
      `
        UPDATE bookings
        SET
          user_id = $1,
          status = 'awaiting_payment',
          completed_at = NULL
        WHERE booking_date = $2
          AND start_hour = $3
          AND status = 'cancelled'
        RETURNING id, booking_date, start_hour, end_hour, status
      `,
      [req.user.id, booking_date, start_hour]
    )

    if (reused.rows.length > 0) {
      await pool.query(
        `UPDATE bookings SET end_hour = $1 WHERE id = $2 AND end_hour IS NULL`,
        [start_hour + 2, reused.rows[0].id]
      )
      await syncBookingOptions(pool, reused.rows[0].id, uniqueOptionIds)
      const updated = await pool.query(
        `SELECT id, booking_date, start_hour, end_hour, status FROM bookings WHERE id = $1`,
        [reused.rows[0].id]
      )
      return res.status(201).json({ success: true, booking: updated.rows[0] })
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
    const result = await pool.query(
      `
        SELECT id, booking_date, start_hour, end_hour, status, created_at, completed_at
        FROM bookings
        WHERE user_id = $1
        ORDER BY booking_date DESC, start_hour DESC
      `,
      [req.user.id]
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
