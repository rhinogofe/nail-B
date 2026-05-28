const router = require('express').Router()
const auth   = require('../middleware/authMiddleware')
const admin  = require('../middleware/adminMiddleware')
const { getPool, withTransaction } = require('../db/pool')

function addDaysYmd(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

function buildDateRange(startDate, dayCount) {
  const dates = []
  let current = startDate
  for (let i = 0; i < dayCount; i += 1) {
    dates.push(current)
    current = addDaysYmd(current, 1)
  }
  return dates
}

router.get('/bookings', auth, admin, async (req, res) => {
  const { date, status } = req.query
  try {
    const pool = getPool()
    const params = []
    let where = 'WHERE 1=1'

    if (date) {
      params.push(date)
      where += ` AND b.booking_date = $${params.length}`
    }
    if (status) {
      params.push(status)
      where += ` AND b.status = $${params.length}`
    }

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
          u.id         AS user_id,
          u.name       AS user_name,
          u.email      AS user_email,
          u.avatar_url AS user_avatar,
          u.total_points
        FROM bookings b
        JOIN users u ON u.id = b.user_id
        ${where}
        ORDER BY b.booking_date ASC, b.start_hour ASC
      `,
      params
    )

    const optionsResult = await pool.query(
      `
        SELECT b.id AS booking_id, n.id AS option_id, n.option_name
        FROM bookings b
        JOIN booking_nailoptions bn ON bn.booking_id = b.id
        JOIN nailoption n ON n.id = bn.nailoption_id
        ${where}
        ORDER BY b.booking_date ASC, b.start_hour ASC, n.option_name ASC
      `,
      params
    )

    const optionsByBookingId = {}
    for (const row of optionsResult.rows) {
      if (!optionsByBookingId[row.booking_id]) optionsByBookingId[row.booking_id] = []
      optionsByBookingId[row.booking_id].push({
        id: row.option_id,
        option_name: row.option_name,
      })
    }

    const payload = result.rows.map((item) => ({
      ...item,
      nail_options: optionsByBookingId[item.id] || [],
    }))

    res.json(payload)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.patch('/bookings/:id/cancel-unpaid', auth, admin, async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.query(
      `
        UPDATE bookings
        SET status = 'cancelled'
        WHERE id = $1
          AND status = 'awaiting_payment'
      `,
      [req.params.id]
    )

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'ไม่พบคิวที่รอชำระเงินให้ยกเลิก' })
    }

    res.json({ success: true, message: 'ยกเลิกคิวที่ยังไม่ชำระเงินแล้ว' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.patch('/bookings/:id/cancel-paid', auth, admin, async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.query(
      `
        UPDATE bookings
        SET status = 'cancelled'
        WHERE id = $1
          AND status = 'pending'
      `,
      [req.params.id]
    )

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'ไม่พบคิวที่ชำระแล้วให้ยกเลิก' })
    }

    res.json({
      success: true,
      message: 'ยกเลิกคิวชำระแล้วแล้ว ช่วงเวลานี้ว่างให้จองใหม่ได้',
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/blocks', auth, admin, async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7)
  const [y, m] = month.split('-').map(Number)
  if (!y || !m) return res.status(400).json({ error: 'month ต้องเป็น YYYY-MM' })

  const fromDate = new Date(y, m - 1, 1)
  const toDate = new Date(y, m, 0)
  const from = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}-${String(fromDate.getDate()).padStart(2, '0')}`
  const to = `${toDate.getFullYear()}-${String(toDate.getMonth() + 1).padStart(2, '0')}-${String(toDate.getDate()).padStart(2, '0')}`

  try {
    const pool = getPool()
    const result = await pool.query(
      `
        SELECT id, block_date, start_hour, end_hour, is_full_day, note, created_at
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

router.post('/blocks', auth, admin, async (req, res) => {
  const { block_date, is_full_day, start_hour, end_hour, note } = req.body
  if (!block_date) return res.status(400).json({ error: 'ต้องระบุ block_date' })
  if (!is_full_day) {
    if (start_hour == null || end_hour == null) {
      return res.status(400).json({ error: 'ต้องระบุ start_hour และ end_hour' })
    }
    if (start_hour < 0 || end_hour > 24 || end_hour <= start_hour) {
      return res.status(400).json({ error: 'ช่วงเวลาปิดไม่ถูกต้อง' })
    }
  }

  try {
    const pool = getPool()
    const result = await pool.query(
      `
        INSERT INTO booking_blocks (block_date, start_hour, end_hour, is_full_day, note)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, block_date, start_hour, end_hour, is_full_day, note, created_at
      `,
      [
        block_date,
        is_full_day ? null : start_hour,
        is_full_day ? null : end_hour,
        Boolean(is_full_day),
        note || null,
      ]
    )
    res.status(201).json({ success: true, block: result.rows[0] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/blocks/bulk', auth, admin, async (req, res) => {
  const { start_date, days, is_full_day, start_hour, end_hour, note } = req.body
  const dayCount = Number(days)

  if (!start_date) return res.status(400).json({ error: 'ต้องระบุ start_date' })
  if (!Number.isInteger(dayCount) || dayCount < 1 || dayCount > 90) {
    return res.status(400).json({ error: 'days ต้องอยู่ระหว่าง 1-90' })
  }
  if (!is_full_day) {
    if (start_hour == null || end_hour == null) {
      return res.status(400).json({ error: 'ต้องระบุ start_hour และ end_hour' })
    }
    if (start_hour < 0 || end_hour > 24 || end_hour <= start_hour) {
      return res.status(400).json({ error: 'ช่วงเวลาปิดไม่ถูกต้อง' })
    }
  }

  const dates = buildDateRange(start_date, dayCount)
  const fullDay = Boolean(is_full_day)
  const startH = fullDay ? null : start_hour
  const endH = fullDay ? null : end_hour
  const blockNote = note || null

  try {
    const result = await withTransaction(async (client) => {
      let created = 0
      let skipped = 0

      for (const blockDate of dates) {
        if (fullDay) {
          const exists = await client.query(
            `SELECT 1 FROM booking_blocks WHERE block_date = $1 AND is_full_day = true LIMIT 1`,
            [blockDate]
          )
          if (exists.rows.length > 0) {
            skipped += 1
            continue
          }
        } else {
          const exists = await client.query(
            `
              SELECT 1 FROM booking_blocks
              WHERE block_date = $1
                AND (
                  is_full_day = true
                  OR (is_full_day = false AND start_hour = $2 AND end_hour = $3)
                )
              LIMIT 1
            `,
            [blockDate, startH, endH]
          )
          if (exists.rows.length > 0) {
            skipped += 1
            continue
          }
        }

        await client.query(
          `
            INSERT INTO booking_blocks (block_date, start_hour, end_hour, is_full_day, note)
            VALUES ($1, $2, $3, $4, $5)
          `,
          [blockDate, startH, endH, fullDay, blockNote]
        )
        created += 1
      }

      return { created, skipped, total: dates.length, end_date: dates[dates.length - 1] }
    })

    const skipHint = fullDay ? 'วันที่ปิดทั้งวันอยู่แล้ว' : 'วันที่มีช่วงเวลานี้หรือปิดทั้งวันอยู่แล้ว'
    res.status(201).json({
      success: true,
      message: `ปิดรับคิวแล้ว ${result.created} วัน (ข้าม ${result.skipped} วัน — ${skipHint})`,
      ...result,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/blocks/:id', auth, admin, async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.query(`DELETE FROM booking_blocks WHERE id = $1`, [req.params.id])

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'ไม่พบรายการปิดวันเวลา' })
    }
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/settings/deposit', auth, admin, async (req, res) => {
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

router.patch('/settings/deposit', auth, admin, async (req, res) => {
  const amount = Number(req.body?.deposit_amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'deposit_amount ต้องมากกว่า 0' })
  }

  try {
    const pool = getPool()
    await pool.query(
      `
        UPDATE app_settings
        SET setting_value = $1, updated_at = NOW()
        WHERE setting_key = 'deposit_amount'
      `,
      [String(amount)]
    )
    res.json({ success: true, deposit_amount: amount })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.patch('/coupons/use', auth, admin, async (req, res) => {
  const couponCode = String(req.body?.coupon_code || '').trim().toUpperCase()
  if (!couponCode) {
    return res.status(400).json({ error: 'กรุณาระบุรหัสคูปอง' })
  }

  try {
    const pool = getPool()
    const result = await pool.query(
      `
        UPDATE coupons
        SET is_used = true, used_at = NOW()
        WHERE coupon_code = $1
          AND is_used = false
        RETURNING id, coupon_code, discount_percent, user_id
      `,
      [couponCode]
    )

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'ไม่พบคูปอง หรือคูปองถูกใช้ไปแล้ว' })
    }

    res.json({ success: true, message: 'ใช้คูปองเรียบร้อยแล้ว', coupon: result.rows[0] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.patch('/bookings/:id/confirm-payment', auth, admin, async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.query(
      `
        UPDATE bookings
        SET status = 'pending'
        WHERE id = $1
          AND status = 'awaiting_payment'
      `,
      [req.params.id]
    )

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'ไม่พบคิวที่รอยืนยันชำระเงิน' })
    }

    res.json({ success: true, message: 'ยืนยันชำระเงินแล้ว คิวพร้อมให้บริการ' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.patch('/bookings/:id/complete', auth, admin, async (req, res) => {
  try {
    await withTransaction(async (client) => {
      const found = await client.query(
        `SELECT * FROM bookings WHERE id = $1 AND status = 'pending'`,
        [req.params.id]
      )
      if (!found.rows[0]) {
        const err = new Error('ไม่พบคิว หรือทำเสร็จแล้ว')
        err.status = 404
        throw err
      }
      const booking = found.rows[0]

      await client.query(
        `UPDATE bookings SET status = 'done', completed_at = NOW() WHERE id = $1`,
        [booking.id]
      )

      await client.query(
        `INSERT INTO point_logs (user_id, booking_id, points) VALUES ($1, $2, 10)`,
        [booking.user_id, booking.id]
      )

      await client.query(
        `UPDATE users SET total_points = total_points + 10 WHERE id = $1`,
        [booking.user_id]
      )
    })

    res.json({ success: true, message: 'เสร็จแล้ว! ลูกค้าได้รับ +10 คะแนน' })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    res.status(500).json({ error: err.message })
  }
})

router.get('/users', auth, admin, async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.query(`
      SELECT
        u.id, u.name, u.email, u.avatar_url, u.provider,
        u.total_points, u.created_at,
        COUNT(b.id)::int AS total_bookings,
        SUM(CASE WHEN b.status = 'done' THEN 1 ELSE 0 END)::int AS completed_bookings
      FROM users u
      LEFT JOIN bookings b ON b.user_id = u.id
      WHERE u.is_admin = false
      GROUP BY u.id, u.name, u.email, u.avatar_url, u.provider, u.total_points, u.created_at
      ORDER BY u.total_points DESC
    `)
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.patch('/users/:id/set-admin', auth, admin, async (req, res) => {
  const { is_admin } = req.body
  try {
    const pool = getPool()
    await pool.query(`UPDATE users SET is_admin = $1 WHERE id = $2`, [Boolean(is_admin), req.params.id])
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Nailoption CRUD ───────────────────────────────────────────

function parseOptionalDate(value) {
  if (value == null || value === '') return null
  const date = String(value).trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: 'รูปแบบวันที่ไม่ถูกต้อง (YYYY-MM-DD)' }
  }
  return date
}

function validateShowDateRange(showFrom, showTo) {
  if (showFrom && showTo && showFrom > showTo) {
    return { error: 'วันเริ่มแสดงต้องไม่เกินวันสิ้นสุดแสดง' }
  }
  return null
}

router.get('/nailoptions', auth, admin, async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.query(`
      SELECT id, option_name, description, price, duration_min, is_active,
             show_from_date, show_to_date, created_at, updated_at
      FROM nailoption
      ORDER BY option_name ASC
    `)
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/nailoptions', auth, admin, async (req, res) => {
  const option_name = String(req.body?.option_name || '').trim()
  const description = String(req.body?.description || '').trim() || null
  const price = Number(req.body?.price)
  const duration_min = Number(req.body?.duration_min)
  const is_active = req.body?.is_active !== false
  const showFromParsed = parseOptionalDate(req.body?.show_from_date)
  const showToParsed = parseOptionalDate(req.body?.show_to_date)

  if (!option_name) return res.status(400).json({ error: 'กรุณาระบุชื่อบริการ' })
  if (!Number.isFinite(price) || price < 0) {
    return res.status(400).json({ error: 'ราคาไม่ถูกต้อง' })
  }
  if (!Number.isFinite(duration_min) || duration_min <= 0) {
    return res.status(400).json({ error: 'ระยะเวลา (นาที) ต้องมากกว่า 0' })
  }
  if (showFromParsed?.error) return res.status(400).json({ error: showFromParsed.error })
  if (showToParsed?.error) return res.status(400).json({ error: showToParsed.error })
  const rangeError = validateShowDateRange(showFromParsed, showToParsed)
  if (rangeError) return res.status(400).json(rangeError)

  try {
    const pool = getPool()
    const result = await pool.query(
      `
        INSERT INTO nailoption (
          option_name, description, price, duration_min, is_active,
          show_from_date, show_to_date
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, option_name, description, price, duration_min, is_active,
                  show_from_date, show_to_date, created_at, updated_at
      `,
      [option_name, description, price, duration_min, is_active, showFromParsed, showToParsed]
    )
    res.status(201).json({ success: true, option: result.rows[0] })
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'ชื่อบริการซ้ำ กรุณาใช้ชื่ออื่น' })
    }
    res.status(500).json({ error: err.message })
  }
})

router.patch('/nailoptions/:id', auth, admin, async (req, res) => {
  const option_name = String(req.body?.option_name || '').trim()
  const description = String(req.body?.description || '').trim() || null
  const price = Number(req.body?.price)
  const duration_min = Number(req.body?.duration_min)
  const is_active = Boolean(req.body?.is_active)
  const showFromParsed = parseOptionalDate(req.body?.show_from_date)
  const showToParsed = parseOptionalDate(req.body?.show_to_date)

  if (!option_name) return res.status(400).json({ error: 'กรุณาระบุชื่อบริการ' })
  if (!Number.isFinite(price) || price < 0) {
    return res.status(400).json({ error: 'ราคาไม่ถูกต้อง' })
  }
  if (!Number.isFinite(duration_min) || duration_min <= 0) {
    return res.status(400).json({ error: 'ระยะเวลา (นาที) ต้องมากกว่า 0' })
  }
  if (showFromParsed?.error) return res.status(400).json({ error: showFromParsed.error })
  if (showToParsed?.error) return res.status(400).json({ error: showToParsed.error })
  const rangeError = validateShowDateRange(showFromParsed, showToParsed)
  if (rangeError) return res.status(400).json(rangeError)

  try {
    const pool = getPool()
    const result = await pool.query(
      `
        UPDATE nailoption
        SET
          option_name = $1,
          description = $2,
          price = $3,
          duration_min = $4,
          is_active = $5,
          show_from_date = $6,
          show_to_date = $7,
          updated_at = NOW()
        WHERE id = $8
        RETURNING id, option_name, description, price, duration_min, is_active,
                  show_from_date, show_to_date, created_at, updated_at
      `,
      [option_name, description, price, duration_min, is_active, showFromParsed, showToParsed, req.params.id]
    )

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'ไม่พบรายการบริการ' })
    }

    res.json({ success: true, option: result.rows[0] })
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'ชื่อบริการซ้ำ กรุณาใช้ชื่ออื่น' })
    }
    res.status(500).json({ error: err.message })
  }
})

router.delete('/nailoptions/:id', auth, admin, async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.query(`DELETE FROM nailoption WHERE id = $1`, [req.params.id])

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'ไม่พบรายการบริการ' })
    }

    res.json({ success: true, message: 'ลบรายการบริการแล้ว' })
  } catch (err) {
    if (err.code === '23503') {
      return res.status(409).json({
        error: 'บริการนี้ถูกใช้ในคิวจองแล้ว ให้ปิดการใช้งาน (ไม่แสดง) แทนการลบ',
      })
    }
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
