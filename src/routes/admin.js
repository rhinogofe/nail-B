const router = require('express').Router()
const auth   = require('../middleware/authMiddleware')
const admin  = require('../middleware/adminMiddleware')
const { sql, getPool } = require('../db/pool')

// ─── GET /api/admin/bookings ──────────────────────────────────
// ดูคิวทั้งหมด (กรองตาม date หรือ status ได้)
router.get('/bookings', auth, admin, async (req, res) => {
  const { date, status } = req.query
  try {
    const pool = await getPool()
    const req2 = pool.request()

    let where = 'WHERE 1=1'
    if (date) {
      req2.input('date', sql.Date, date)
      where += ' AND b.booking_date = @date'
    }
    if (status) {
      req2.input('status', sql.NVarChar, status)
      where += ' AND b.status = @status'
    }

    const result = await req2.query(`
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
    `)

    const req3 = pool.request()
    let where2 = 'WHERE 1=1'
    if (date) {
      req3.input('date', sql.Date, date)
      where2 += ' AND b.booking_date = @date'
    }
    if (status) {
      req3.input('status', sql.NVarChar, status)
      where2 += ' AND b.status = @status'
    }

    const optionsResult = await req3.query(`
      SELECT b.id AS booking_id, n.id AS option_id, n.option_name
      FROM bookings b
      JOIN booking_nailoptions bn ON bn.booking_id = b.id
      JOIN Nailoption n ON n.id = bn.nailoption_id
      ${where2}
      ORDER BY b.booking_date ASC, b.start_hour ASC, n.option_name ASC
    `)

    const optionsByBookingId = {}
    for (const row of optionsResult.recordset) {
      if (!optionsByBookingId[row.booking_id]) optionsByBookingId[row.booking_id] = []
      optionsByBookingId[row.booking_id].push({
        id: row.option_id,
        option_name: row.option_name,
      })
    }

    const payload = result.recordset.map((item) => ({
      ...item,
      nail_options: optionsByBookingId[item.id] || [],
    }))

    res.json(payload)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── PATCH /api/admin/bookings/:id/cancel-unpaid ───────────────
// ยกเลิกคิวที่ยังไม่ชำระเงิน
router.patch('/bookings/:id/cancel-unpaid', auth, admin, async (req, res) => {
  try {
    const pool = await getPool()
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, req.params.id)
      .query(`
        UPDATE bookings
        SET status = 'cancelled'
        WHERE id = @id
          AND status = 'awaiting_payment'
      `)

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'ไม่พบคิวที่รอชำระเงินให้ยกเลิก' })
    }

    res.json({ success: true, message: 'ยกเลิกคิวที่ยังไม่ชำระเงินแล้ว' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── GET /api/admin/blocks?month=YYYY-MM ───────────────────────
router.get('/blocks', auth, admin, async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7)
  const [y, m] = month.split('-').map(Number)
  if (!y || !m) return res.status(400).json({ error: 'month ต้องเป็น YYYY-MM' })

  const fromDate = new Date(y, m - 1, 1)
  const toDate = new Date(y, m, 0)
  const from = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}-${String(fromDate.getDate()).padStart(2, '0')}`
  const to = `${toDate.getFullYear()}-${String(toDate.getMonth() + 1).padStart(2, '0')}-${String(toDate.getDate()).padStart(2, '0')}`

  try {
    const pool = await getPool()
    const result = await pool.request()
      .input('fromDate', sql.Date, from)
      .input('toDate', sql.Date, to)
      .query(`
        SELECT id, block_date, start_hour, end_hour, is_full_day, note, created_at
        FROM booking_blocks
        WHERE block_date BETWEEN @fromDate AND @toDate
        ORDER BY block_date ASC, is_full_day DESC, start_hour ASC
      `)
    res.json(result.recordset)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── POST /api/admin/blocks ─────────────────────────────────────
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
    const pool = await getPool()
    const result = await pool.request()
      .input('blockDate', sql.Date, block_date)
      .input('isFullDay', sql.Bit, is_full_day ? 1 : 0)
      .input('startHour', sql.TinyInt, is_full_day ? null : start_hour)
      .input('endHour', sql.TinyInt, is_full_day ? null : end_hour)
      .input('note', sql.NVarChar(255), note || null)
      .query(`
        INSERT INTO booking_blocks (block_date, start_hour, end_hour, is_full_day, note)
        OUTPUT INSERTED.id, INSERTED.block_date, INSERTED.start_hour, INSERTED.end_hour, INSERTED.is_full_day, INSERTED.note, INSERTED.created_at
        VALUES (@blockDate, @startHour, @endHour, @isFullDay, @note)
      `)
    res.status(201).json({ success: true, block: result.recordset[0] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── DELETE /api/admin/blocks/:id ──────────────────────────────
router.delete('/blocks/:id', auth, admin, async (req, res) => {
  try {
    const pool = await getPool()
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, req.params.id)
      .query(`DELETE FROM booking_blocks WHERE id = @id`)

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'ไม่พบรายการปิดวันเวลา' })
    }
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── GET /api/admin/settings/deposit ────────────────────────────
router.get('/settings/deposit', auth, admin, async (req, res) => {
  try {
    const pool = await getPool()
    const result = await pool.request()
      .query(`SELECT setting_value FROM app_settings WHERE setting_key='deposit_amount'`)
    const value = result.recordset[0]?.setting_value || '300'
    res.json({ deposit_amount: Number(value) || 300 })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── PATCH /api/admin/settings/deposit ──────────────────────────
router.patch('/settings/deposit', auth, admin, async (req, res) => {
  const amount = Number(req.body?.deposit_amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'deposit_amount ต้องมากกว่า 0' })
  }

  try {
    const pool = await getPool()
    await pool.request()
      .input('value', sql.NVarChar(255), String(amount))
      .query(`
        UPDATE app_settings
        SET setting_value = @value, updated_at = SYSDATETIME()
        WHERE setting_key = 'deposit_amount'
      `)
    res.json({ success: true, deposit_amount: amount })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── PATCH /api/admin/coupons/use ───────────────────────────────
router.patch('/coupons/use', auth, admin, async (req, res) => {
  const couponCode = String(req.body?.coupon_code || '').trim().toUpperCase()
  if (!couponCode) {
    return res.status(400).json({ error: 'กรุณาระบุรหัสคูปอง' })
  }

  try {
    const pool = await getPool()
    const result = await pool.request()
      .input('code', sql.NVarChar, couponCode)
      .query(`
        UPDATE coupons
        SET is_used = 1, used_at = SYSDATETIME()
        OUTPUT INSERTED.id, INSERTED.coupon_code, INSERTED.discount_percent, INSERTED.user_id
        WHERE coupon_code = @code
          AND is_used = 0
      `)

    if (!result.recordset[0]) {
      return res.status(404).json({ error: 'ไม่พบคูปอง หรือคูปองถูกใช้ไปแล้ว' })
    }

    res.json({ success: true, message: 'ใช้คูปองเรียบร้อยแล้ว', coupon: result.recordset[0] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── PATCH /api/admin/bookings/:id/confirm-payment ─────────────
// ยืนยันสลิปแล้ว -> เปลี่ยนจาก awaiting_payment เป็น pending
router.patch('/bookings/:id/confirm-payment', auth, admin, async (req, res) => {
  try {
    const pool = await getPool()
    const result = await pool.request()
      .input('id', sql.UniqueIdentifier, req.params.id)
      .query(`
        UPDATE bookings
        SET status = 'pending'
        WHERE id = @id
          AND status = 'awaiting_payment'
      `)

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'ไม่พบคิวที่รอยืนยันชำระเงิน' })
    }

    res.json({ success: true, message: 'ยืนยันชำระเงินแล้ว คิวพร้อมให้บริการ' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── PATCH /api/admin/bookings/:id/complete ───────────────────
// แอดมินกดเสร็จ → เปลี่ยน status + บวก 10 คะแนนให้ลูกค้า (transaction)
router.patch('/bookings/:id/complete', auth, admin, async (req, res) => {
  const pool = await getPool()

  const transaction = new (require('mssql').Transaction)(pool)
  try {
    await transaction.begin()
    const req2 = new (require('mssql').Request)(transaction)

    // ดึงคิว
    req2.input('id', sql.UniqueIdentifier, req.params.id)
    const found = await req2.query(
      `SELECT * FROM bookings WHERE id=@id AND status='pending'`
    )
    if (!found.recordset[0]) {
      await transaction.rollback()
      return res.status(404).json({ error: 'ไม่พบคิว หรือทำเสร็จแล้ว' })
    }
    const booking = found.recordset[0]

    // อัปเดต booking → done
    const req3 = new (require('mssql').Request)(transaction)
    req3.input('id', sql.UniqueIdentifier, booking.id)
    await req3.query(
      `UPDATE bookings SET status='done', completed_at=GETDATE() WHERE id=@id`
    )

    // เพิ่ม point_log
    const req4 = new (require('mssql').Request)(transaction)
    req4.input('userId',    sql.UniqueIdentifier, booking.user_id)
    req4.input('bookingId', sql.UniqueIdentifier, booking.id)
    await req4.query(
      `INSERT INTO point_logs (user_id, booking_id, points) VALUES (@userId, @bookingId, 10)`
    )

    // บวก total_points ให้ user
    const req5 = new (require('mssql').Request)(transaction)
    req5.input('userId', sql.UniqueIdentifier, booking.user_id)
    await req5.query(
      `UPDATE users SET total_points = total_points + 10 WHERE id=@userId`
    )

    await transaction.commit()
    res.json({ success: true, message: 'เสร็จแล้ว! ลูกค้าได้รับ +10 คะแนน' })
  } catch (err) {
    await transaction.rollback().catch(() => {})
    res.status(500).json({ error: err.message })
  }
})

// ─── GET /api/admin/users ─────────────────────────────────────
// ดูรายชื่อลูกค้าและคะแนนทั้งหมด
router.get('/users', auth, admin, async (req, res) => {
  try {
    const pool = await getPool()
    const result = await pool.request().query(`
      SELECT
        u.id, u.name, u.email, u.avatar_url, u.provider,
        u.total_points, u.created_at,
        COUNT(b.id) AS total_bookings,
        SUM(CASE WHEN b.status='done' THEN 1 ELSE 0 END) AS completed_bookings
      FROM users u
      LEFT JOIN bookings b ON b.user_id = u.id
      WHERE u.is_admin = 0
      GROUP BY u.id, u.name, u.email, u.avatar_url, u.provider, u.total_points, u.created_at
      ORDER BY u.total_points DESC
    `)
    res.json(result.recordset)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── PATCH /api/admin/users/:id/set-admin ────────────────────
// ให้/ถอนสิทธิ์แอดมิน
router.patch('/users/:id/set-admin', auth, admin, async (req, res) => {
  const { is_admin } = req.body
  try {
    const pool = await getPool()
    await pool.request()
      .input('id',      sql.UniqueIdentifier, req.params.id)
      .input('isAdmin', sql.Bit,              is_admin ? 1 : 0)
      .query(`UPDATE users SET is_admin=@isAdmin WHERE id=@id`)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
