const router = require('express').Router()
const auth   = require('../middleware/authMiddleware')
const { sql, getPool } = require('../db/pool')

async function syncBookingOptions(pool, bookingId, optionIds) {
  const deleteReq = pool.request()
  deleteReq.input('bookingId', sql.UniqueIdentifier, bookingId)
  await deleteReq.query(`DELETE FROM booking_nailoptions WHERE booking_id = @bookingId`)

  if (!optionIds.length) return

  const valuesSql = optionIds.map((_, idx) => `(@bookingId, @optionId${idx})`).join(', ')
  const insertReq = pool.request()
  insertReq.input('bookingId', sql.UniqueIdentifier, bookingId)
  optionIds.forEach((id, idx) => {
    insertReq.input(`optionId${idx}`, sql.UniqueIdentifier, id)
  })
  await insertReq.query(`
    INSERT INTO booking_nailoptions (booking_id, nailoption_id)
    VALUES ${valuesSql}
  `)
}

async function validateOptionIds(pool, optionIds) {
  const req = pool.request()
  const inParams = optionIds.map((_, idx) => `@optionId${idx}`).join(', ')
  optionIds.forEach((id, idx) => req.input(`optionId${idx}`, sql.UniqueIdentifier, id))
  const result = await req.query(`
    SELECT id
    FROM Nailoption
    WHERE is_active = 1
      AND id IN (${inParams})
  `)
  return result.recordset.length === optionIds.length
}

// ─── GET /api/bookings/deposit-setting ─────────────────────────
router.get('/deposit-setting', auth, async (req, res) => {
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

// ─── GET /api/bookings/options ──────────────────────────────────
router.get('/options', auth, async (req, res) => {
  try {
    const pool = await getPool()
    const result = await pool.request().query(`
      SELECT id, option_name, description, price, duration_min, is_active
      FROM Nailoption
      WHERE is_active = 1
      ORDER BY
        CASE WHEN description IS NULL OR LTRIM(RTRIM(description)) = '' THEN 1 ELSE 0 END,
        description ASC,
        option_name ASC
    `)
    res.json(result.recordset)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── GET /api/bookings?date=YYYY-MM-DD ────────────────────────
// คืนสล็อตที่จองแล้วในวันนั้น พร้อมบอกว่าอันไหนเป็นของตัวเอง
router.get('/', auth, async (req, res) => {
  const { date } = req.query
  if (!date) return res.status(400).json({ error: 'ต้องระบุ date (YYYY-MM-DD)' })

  try {
    const pool = await getPool()
    const result = await pool.request()
      .input('date',   sql.Date,            date)
      .input('userId', sql.UniqueIdentifier, req.user.id)
      .query(`
        SELECT
          b.id,
          b.start_hour,
          b.end_hour,
          b.status,
          u.name        AS user_name,
          u.avatar_url  AS user_avatar,
          CASE WHEN b.user_id = @userId THEN 1 ELSE 0 END AS is_mine
        FROM bookings b
        JOIN users u ON u.id = b.user_id
        WHERE b.booking_date = @date
          AND b.status != 'cancelled'
        ORDER BY b.start_hour
      `)

    const blocks = await pool.request()
      .input('date', sql.Date, date)
      .query(`
        SELECT id, block_date, start_hour, end_hour, is_full_day, note
        FROM booking_blocks
        WHERE block_date = @date
        ORDER BY is_full_day DESC, start_hour ASC
      `)

    res.json({
      bookings: result.recordset,
      blocks: blocks.recordset,
      is_closed_day: blocks.recordset.some((b) => b.is_full_day),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── GET /api/bookings/blocks?from=YYYY-MM-DD&to=YYYY-MM-DD ───
router.get('/blocks', auth, async (req, res) => {
  const { from, to } = req.query
  if (!from || !to) return res.status(400).json({ error: 'ต้องระบุ from และ to' })

  try {
    const pool = await getPool()
    const result = await pool.request()
      .input('fromDate', sql.Date, from)
      .input('toDate', sql.Date, to)
      .query(`
        SELECT id, block_date, start_hour, end_hour, is_full_day, note
        FROM booking_blocks
        WHERE block_date BETWEEN @fromDate AND @toDate
        ORDER BY block_date ASC, is_full_day DESC, start_hour ASC
      `)
    res.json(result.recordset)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── POST /api/bookings ───────────────────────────────────────
// จองคิว — ถ้าสล็อตซ้ำจะ return 409
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
    const pool = await getPool()
    const uniqueOptionIds = [...new Set(option_ids)]
    const isValidOptions = await validateOptionIds(pool, uniqueOptionIds)
    if (!isValidOptions) {
      return res.status(400).json({ error: 'รายการบริการที่เลือกไม่ถูกต้อง' })
    }

    const overlap = await pool.request()
      .input('bookingDate', sql.Date, booking_date)
      .input('newStart', sql.TinyInt, start_hour)
      .input('newEnd', sql.TinyInt, start_hour + 2)
      .query(`
        SELECT TOP 1 id
        FROM bookings
        WHERE booking_date = @bookingDate
          AND status != 'cancelled'
          AND start_hour < @newEnd
          AND ISNULL(end_hour, start_hour + 2) > @newStart
      `)

    if (overlap.recordset.length > 0) {
      return res.status(409).json({ error: 'เวลานี้ทับกับคิวอื่น กรุณาเลือกเวลาใหม่' })
    }

    const blocked = await pool.request()
      .input('bookingDate', sql.Date, booking_date)
      .input('newStart', sql.TinyInt, start_hour)
      .input('newEnd', sql.TinyInt, start_hour + 2)
      .query(`
        SELECT TOP 1 id
        FROM booking_blocks
        WHERE block_date = @bookingDate
          AND (
            is_full_day = 1
            OR (start_hour < @newEnd AND end_hour > @newStart)
          )
      `)

    if (blocked.recordset.length > 0) {
      return res.status(409).json({ error: 'ช่วงเวลานี้ร้านปิดรับคิว' })
    }

    // If a cancelled slot exists at the exact same time, reuse it instead of inserting.
    // This avoids unique-index conflicts on (booking_date, start_hour).
    const reused = await pool.request()
      .input('userId',      sql.UniqueIdentifier, req.user.id)
      .input('bookingDate', sql.Date,             booking_date)
      .input('startHour',   sql.TinyInt,          start_hour)
      .query(`
        UPDATE bookings
        SET
          user_id = @userId,
          status = 'awaiting_payment',
          completed_at = NULL
        OUTPUT INSERTED.id, INSERTED.booking_date, INSERTED.start_hour, INSERTED.end_hour, INSERTED.status
        WHERE booking_date = @bookingDate
          AND start_hour = @startHour
          AND status = 'cancelled'
      `)

    if (reused.recordset.length > 0) {
      await syncBookingOptions(pool, reused.recordset[0].id, uniqueOptionIds)
      return res.status(201).json({ success: true, booking: reused.recordset[0] })
    }

    const result = await pool.request()
      .input('userId',      sql.UniqueIdentifier, req.user.id)
      .input('bookingDate', sql.Date,             booking_date)
      .input('startHour',   sql.TinyInt,          start_hour)
      .query(`
        INSERT INTO bookings (user_id, booking_date, start_hour, status)
        OUTPUT INSERTED.id, INSERTED.booking_date, INSERTED.start_hour, INSERTED.end_hour, INSERTED.status
        VALUES (@userId, @bookingDate, @startHour, 'awaiting_payment')
      `)
    await syncBookingOptions(pool, result.recordset[0].id, uniqueOptionIds)
    res.status(201).json({ success: true, booking: result.recordset[0] })
  } catch (err) {
    if (err.number === 2627 || err.number === 2601) {
      return res.status(409).json({ error: 'เวลานี้ถูกจองแล้ว กรุณาเลือกเวลาอื่น' })
    }
    res.status(500).json({ error: err.message })
  }
})

// ─── DELETE /api/bookings/:id ─────────────────────────────────
// ยกเลิกคิวของตัวเอง (เฉพาะ pending)
router.delete('/:id', auth, async (req, res) => {
  try {
    const pool = await getPool()
    const result = await pool.request()
      .input('id',     sql.UniqueIdentifier, req.params.id)
      .input('userId', sql.UniqueIdentifier, req.user.id)
      .query(`
        UPDATE bookings
        SET status = 'cancelled'
        WHERE id = @id
          AND user_id = @userId
          AND status = 'awaiting_payment'
      `)

    if (result.rowsAffected[0] === 0)
      return res.status(404).json({ error: 'ไม่พบคิว หรือไม่สามารถยกเลิกได้' })

    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── GET /api/bookings/my ─────────────────────────────────────
// ประวัติการจองของตัวเอง
router.get('/my', auth, async (req, res) => {
  try {
    const pool = await getPool()
    const result = await pool.request()
      .input('userId', sql.UniqueIdentifier, req.user.id)
      .query(`
        SELECT id, booking_date, start_hour, end_hour, status, created_at, completed_at
        FROM bookings
        WHERE user_id = @userId
        ORDER BY booking_date DESC, start_hour DESC
      `)
    res.json(result.recordset)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
