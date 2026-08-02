const router = require('express').Router()
const auth   = require('../middleware/authMiddleware')
const admin  = require('../middleware/adminMiddleware')
const shopAdminAccess = require('../middleware/shopAdminAccessMiddleware')
const resolveShop = require('../middleware/resolveShop')
const { getPool, withTransaction } = require('../db/pool')
const { getShopSetting, getShopSettings, setShopSetting, setShopSettings } = require('../utils/shopSettings')
const { computeBookUntilDate, getAdvanceSettings, todayYmdBangkok } = require('../utils/bookingWindow')
const {
  syncBookingOptions,
  validateOptionIds,
  validateRequiredOptions,
  normalizeOptionIds,
} = require('../utils/bookingOptions')
const { resolveShowcaseClip, fetchShowcaseThumbnail, showcaseReferer } = require('../utils/showcaseUrl')
const { validateBookingStartHour, getShopHours } = require('../utils/bookingHours')
const {
  getBookingSlotHours,
  bookingEndHour,
  normalizeBookingSlotHours,
  MIN_SLOT_HOURS,
  MAX_SLOT_HOURS,
} = require('../utils/bookingSlotHours')
const { getUiSettings, setUiSettings } = require('../utils/shopUiSettings')
const { getCouponSettings, setCouponSettings } = require('../utils/couponSettings')
const { getLinePushSettings, setLinePushSettings, DEFAULT_TEMPLATE: LINE_NOTIFY_DEFAULT_TEMPLATE } = require('../utils/linePushSettings')
const { notifyShopNewBooking } = require('../utils/bookingLineNotify')
const {
  getUnpaidExpireSettings,
  isBookingExpired,
  expireUnpaidBookings,
  MIN_HOURS,
  MAX_HOURS,
} = require('../utils/unpaidExpire')
const {
  syncShopAdminAssignment,
  attachAdminShopFields,
} = require('../utils/shopAdmins')

router.use(resolveShop)
router.use(auth)
router.use(admin)
router.use(shopAdminAccess)

router.get('/shops', async (req, res) => {
  try {
    const pool = getPool()
    if (req.isSuperAdmin) {
      const result = await pool.query(
        `SELECT id, slug, name, is_active, created_at
         FROM shops
         ORDER BY is_active DESC, name ASC`
      )
      return res.json(result.rows)
    }
    const result = await pool.query(
      `SELECT id, slug, name, is_active, created_at
       FROM shops
       WHERE id = $1
       LIMIT 1`,
      [req.shop.id]
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

function addDaysYmd(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

function normalizePhone(phone) {
  return String(phone || '').replace(/[^\d+]/g, '').trim()
}

async function assertSlotAvailable(client, shopId, bookingDate, startHour, excludeId = null) {
  const slotHours = await getBookingSlotHours(client, shopId)
  const endHour = bookingEndHour(startHour, slotHours)
  const params = [shopId, bookingDate, startHour, endHour, slotHours]
  let excludeClause = ''
  if (excludeId) {
    params.push(excludeId)
    excludeClause = `AND id != $${params.length}`
  }
  const overlap = await client.query(
    `
      SELECT id
      FROM bookings
      WHERE shop_id = $1
        AND booking_date = $2
        AND status != 'cancelled'
        ${excludeClause}
        AND start_hour < $4
        AND COALESCE(end_hour, start_hour + $5) > $3
      LIMIT 1
    `,
    params
  )
  if (overlap.rows.length > 0) {
    const err = new Error('เวลานี้ทับกับคิวอื่น กรุณาเลือกเวลาใหม่')
    err.status = 409
    throw err
  }
}

async function assertSlotNotBlocked(client, shopId, bookingDate, startHour) {
  const slotHours = await getBookingSlotHours(client, shopId)
  const endHour = bookingEndHour(startHour, slotHours)
  const blocked = await client.query(
    `
      SELECT id
      FROM booking_blocks
      WHERE shop_id = $1
        AND block_date = $2
        AND (
          is_full_day = true
          OR (start_hour < $4 AND end_hour > $3)
        )
      LIMIT 1
    `,
    [shopId, bookingDate, startHour, endHour]
  )
  if (blocked.rows.length > 0) {
    const err = new Error('ช่วงเวลานี้ร้านปิดรับคิว')
    err.status = 409
    throw err
  }
}

async function fetchAdminBookingWithOptions(client, shopId, bookingId) {
  const result = await client.query(
    `
      SELECT
        b.id,
        b.booking_date,
        b.start_hour,
        b.end_hour,
        b.status,
        b.created_at,
        b.completed_at,
        b.total,
        u.id AS user_id,
        u.name AS user_name,
        u.email AS user_email
      FROM bookings b
      JOIN users u ON u.id = b.user_id
      WHERE b.id = $1 AND b.shop_id = $2
    `,
    [bookingId, shopId]
  )
  if (!result.rows.length) return null
  const optionsResult = await client.query(
    `
      SELECT n.id, n.option_name
      FROM booking_nailoptions bn
      JOIN nailoption n ON n.id = bn.nailoption_id
      WHERE bn.booking_id = $1
      ORDER BY n.option_name ASC
    `,
    [bookingId]
  )
  return {
    ...result.rows[0],
    nail_options: optionsResult.rows.map((o) => ({
      id: o.id,
      option_name: o.option_name,
    })),
  }
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

router.get('/bookings', async (req, res) => {
  const { date, status } = req.query
  const shopId = req.shop.id
  try {
    const pool = getPool()
    await expireUnpaidBookings(pool, shopId)
    const params = [shopId]
    let where = 'WHERE b.shop_id = $1'

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
          b.total,
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

router.get('/bookings/calendar-summary', async (req, res) => {
  const { month } = req.query
  if (!month || !/^\d{4}-\d{2}$/.test(String(month))) {
    return res.status(400).json({ error: 'month ต้องเป็น YYYY-MM' })
  }

  try {
    const pool = getPool()
    const shopId = req.shop.id
    const [y, m] = String(month).split('-').map(Number)
    const from = `${month}-01`
    const lastDay = new Date(y, m, 0).getDate()
    const to = `${month}-${String(lastDay).padStart(2, '0')}`

    const result = await pool.query(
      `
        SELECT
          to_char(booking_date, 'YYYY-MM-DD') AS date,
          COUNT(*) FILTER (WHERE status = 'awaiting_payment')::int AS unpaid_count,
          COUNT(*) FILTER (WHERE status IN ('pending', 'done'))::int AS paid_count,
          COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_count
        FROM bookings
        WHERE shop_id = $1 AND booking_date BETWEEN $2 AND $3
        GROUP BY booking_date
        ORDER BY date ASC
      `,
      [shopId, from, to]
    )

    const days = result.rows.map((row) => ({
      date: row.date,
      unpaid_count: row.unpaid_count,
      paid_count: row.paid_count,
      cancelled_count: row.cancelled_count,
    }))

    const month_paid_count = days.reduce((sum, row) => sum + row.paid_count, 0)
    const month_unpaid_count = days.reduce((sum, row) => sum + row.unpaid_count, 0)
    const month_cancelled_count = days.reduce((sum, row) => sum + row.cancelled_count, 0)

    res.json({
      month: String(month),
      days,
      month_paid_count,
      month_unpaid_count,
      month_cancelled_count,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/revenue/summary', async (req, res) => {
  const { month } = req.query
  if (!month || !/^\d{4}-\d{2}$/.test(String(month))) {
    return res.status(400).json({ error: 'month ต้องเป็น YYYY-MM' })
  }

  try {
    const pool = getPool()
    const shopId = req.shop.id
    const [y, m] = String(month).split('-').map(Number)
    const from = `${month}-01`
    const lastDay = new Date(y, m, 0).getDate()
    const to = `${month}-${String(lastDay).padStart(2, '0')}`

    const depositRate = Number(await getShopSetting(pool, shopId, 'deposit_amount')) || 300

    const result = await pool.query(
      `
        SELECT
          to_char(booking_date, 'YYYY-MM-DD') AS date,
          COUNT(*) FILTER (WHERE status = 'done')::int AS done_count,
          COALESCE(SUM(total) FILTER (WHERE status = 'done' AND total IS NOT NULL), 0)::numeric AS total_amount
        FROM bookings
        WHERE shop_id = $1 AND booking_date BETWEEN $2 AND $3
        GROUP BY booking_date
        ORDER BY date ASC
      `,
      [shopId, from, to]
    )

    const days = result.rows.map((row) => {
      const doneCount = row.done_count
      return {
        date: row.date,
        done_count: doneCount,
        deposit_amount: doneCount * depositRate,
        total_amount: Number(row.total_amount),
      }
    })

    const month_deposit_total = days.reduce((sum, row) => sum + row.deposit_amount, 0)
    const month_total = days.reduce((sum, row) => sum + row.total_amount, 0)
    const month_done_count = days.reduce((sum, row) => sum + row.done_count, 0)

    res.json({
      month: String(month),
      deposit_rate: depositRate,
      days,
      month_deposit_total,
      month_total,
      month_done_count,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/bookings', async (req, res) => {
  const { user_id, booking_date, start_hour, nailoption_ids, status: reqStatus, total } = req.body
  if (!user_id || !booking_date || start_hour == null) {
    return res.status(400).json({ error: 'ต้องระบุ user_id, booking_date และ start_hour' })
  }
  if (!Array.isArray(nailoption_ids) || nailoption_ids.length === 0) {
    return res.status(400).json({ error: 'กรุณาเลือกบริการอย่างน้อย 1 รายการ' })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(booking_date))) {
    return res.status(400).json({ error: 'รูปแบบวันที่ไม่ถูกต้อง' })
  }

  const allowedStatuses = ['awaiting_payment', 'pending', 'done']
  const status = allowedStatuses.includes(reqStatus) ? reqStatus : 'pending'
  const startHourNum = Number(start_hour)
  if (!Number.isInteger(startHourNum)) {
    return res.status(400).json({ error: 'start_hour ไม่ถูกต้อง' })
  }

  const totalProvided = total !== undefined && total !== null && total !== ''
  const totalNum = totalProvided ? Number(total) : null
  if (status === 'done' && (!totalProvided || !Number.isFinite(totalNum) || totalNum < 0)) {
    return res.status(400).json({ error: 'สถานะทำเสร็จแล้วต้องระบุยอดเงิน' })
  }
  if (totalProvided && (!Number.isFinite(totalNum) || totalNum < 0)) {
    return res.status(400).json({ error: 'ยอดเงินไม่ถูกต้อง' })
  }

  try {
    const pool = getPool()
    const shopId = req.shop.id
    const hourError = await validateBookingStartHour(pool, shopId, booking_date, startHourNum, await getBookingSlotHours(pool, shopId))
    if (hourError) {
      return res.status(400).json({ error: hourError })
    }

    const optionIds = normalizeOptionIds(nailoption_ids)
    if (!optionIds.length) {
      return res.status(400).json({ error: 'กรุณาเลือกบริการอย่างน้อย 1 รายการ' })
    }

    const booking = await withTransaction(async (client) => {
      const userRes = await client.query(`SELECT id FROM users WHERE id = $1`, [user_id])
      if (!userRes.rows.length) {
        const err = new Error('ไม่พบผู้ใช้')
        err.status = 404
        throw err
      }

      const isValidOptions = await validateOptionIds(client, shopId, optionIds, null)
      if (!isValidOptions) {
        const err = new Error('รายการบริการที่เลือกไม่ถูกต้อง')
        err.status = 400
        throw err
      }
      const requiredError = await validateRequiredOptions(client, shopId, optionIds, booking_date)
      if (requiredError) {
        const err = new Error(requiredError)
        err.status = 400
        throw err
      }

      await assertSlotAvailable(client, shopId, booking_date, startHourNum)

      const slotHours = await getBookingSlotHours(client, shopId)
      const endHour = bookingEndHour(startHourNum, slotHours)
      const completedAt = status === 'done' ? new Date() : null
      const bookingTotal = totalProvided ? totalNum : null

      const inserted = await client.query(
        `
          INSERT INTO bookings (shop_id, user_id, booking_date, start_hour, end_hour, status, total, completed_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id
        `,
        [shopId, user_id, booking_date, startHourNum, endHour, status, bookingTotal, completedAt]
      )
      const bookingId = inserted.rows[0].id

      await syncBookingOptions(client, bookingId, optionIds)

      if (status === 'done') {
        await client.query(
          `INSERT INTO point_logs (user_id, booking_id, points) VALUES ($1, $2, 10)`,
          [user_id, bookingId]
        )
        await client.query(
          `UPDATE users SET total_points = total_points + 10 WHERE id = $1`,
          [user_id]
        )
      }

      return fetchAdminBookingWithOptions(client, shopId, bookingId)
    })

    res.status(201).json({
      success: true,
      message: status === 'done' ? 'บันทึกคิวย้อนหลังแล้ว (+10 คะแนน)' : 'เพิ่มคิวแล้ว',
      booking,
    })
    notifyShopNewBooking(getPool(), shopId, booking.id).catch(() => null)
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    if (err.code === '23505') {
      return res.status(409).json({ error: 'เวลานี้ถูกจองแล้ว กรุณาเลือกเวลาอื่น' })
    }
    res.status(500).json({ error: err.message })
  }
})

router.patch('/bookings/:id/restore', async (req, res) => {
  const targetStatus = req.body?.status === 'pending' ? 'pending' : 'awaiting_payment'
  const shopId = req.shop.id

  try {
    await withTransaction(async (client) => {
      const existing = await client.query(
        `SELECT id, booking_date, start_hour, status FROM bookings WHERE id = $1 AND shop_id = $2 FOR UPDATE`,
        [req.params.id, shopId]
      )
      if (!existing.rows.length || existing.rows[0].status !== 'cancelled') {
        const err = new Error('ไม่พบคิวที่ยกเลิกแล้ว')
        err.status = 404
        throw err
      }

      const row = existing.rows[0]
      await assertSlotAvailable(client, shopId, row.booking_date, row.start_hour, row.id)

      await client.query(
        `
          UPDATE bookings
          SET
            status = $1,
            completed_at = NULL,
            created_at = CASE WHEN $1 = 'awaiting_payment' THEN NOW() ELSE created_at END
          WHERE id = $2 AND shop_id = $3 AND status = 'cancelled'
        `,
        [targetStatus, row.id, shopId]
      )
    })

    const message =
      targetStatus === 'pending'
        ? 'คืนสถานะจองแล้ว (ชำระแล้ว / รอให้บริการ)'
        : 'คืนสถานะจองแล้ว (รอชำระเงิน · เริ่มนับเวลาชำระใหม่)'

    res.json({ success: true, message })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    res.status(500).json({ error: err.message })
  }
})

router.patch('/bookings/:id/cancel-unpaid', async (req, res) => {
  try {
    const pool = getPool()
    const shopId = req.shop.id
    const result = await pool.query(
      `
        UPDATE bookings
        SET status = 'cancelled'
        WHERE id = $1
          AND shop_id = $2
          AND status = 'awaiting_payment'
      `,
      [req.params.id, shopId]
    )

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'ไม่พบคิวที่รอชำระเงินให้ยกเลิก' })
    }

    res.json({ success: true, message: 'ยกเลิกคิวที่ยังไม่ชำระเงินแล้ว' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.patch('/bookings/:id/cancel-paid', async (req, res) => {
  try {
    const pool = getPool()
    const shopId = req.shop.id
    const result = await pool.query(
      `
        UPDATE bookings
        SET status = 'cancelled'
        WHERE id = $1
          AND shop_id = $2
          AND status = 'pending'
      `,
      [req.params.id, shopId]
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

router.delete('/bookings/:id', async (req, res) => {
  const shopId = req.shop.id
  try {
    await withTransaction(async (client) => {
      const bookingRes = await client.query(
        `SELECT id, status FROM bookings WHERE id = $1 AND shop_id = $2`,
        [req.params.id, shopId]
      )
      if (!bookingRes.rows.length) {
        const err = new Error('ไม่พบรายการจอง')
        err.status = 404
        throw err
      }
      if (bookingRes.rows[0].status !== 'cancelled') {
        const err = new Error('ลบได้เฉพาะคิวที่ยกเลิกแล้ว')
        err.status = 400
        throw err
      }
      await client.query(`DELETE FROM point_logs WHERE booking_id = $1`, [req.params.id])
      const result = await client.query(
        `DELETE FROM bookings WHERE id = $1 AND shop_id = $2 AND status = 'cancelled'`,
        [req.params.id, shopId]
      )
      if (result.rowCount === 0) {
        const err = new Error('ไม่พบรายการจอง')
        err.status = 404
        throw err
      }
    })
    res.json({ success: true, message: 'ลบรายการจองแล้ว' })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    res.status(500).json({ error: err.message })
  }
})

router.get('/blocks', async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7)
  const [y, m] = month.split('-').map(Number)
  if (!y || !m) return res.status(400).json({ error: 'month ต้องเป็น YYYY-MM' })

  const fromDate = new Date(y, m - 1, 1)
  const toDate = new Date(y, m, 0)
  const from = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}-${String(fromDate.getDate()).padStart(2, '0')}`
  const to = `${toDate.getFullYear()}-${String(toDate.getMonth() + 1).padStart(2, '0')}-${String(toDate.getDate()).padStart(2, '0')}`

  try {
    const pool = getPool()
    const shopId = req.shop.id
    const result = await pool.query(
      `
        SELECT id, block_date, start_hour, end_hour, is_full_day, note, created_at
        FROM booking_blocks
        WHERE shop_id = $1 AND block_date BETWEEN $2 AND $3
        ORDER BY block_date ASC, is_full_day DESC, start_hour ASC
      `,
      [shopId, from, to]
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/blocks', async (req, res) => {
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
    const shopId = req.shop.id
    const result = await pool.query(
      `
        INSERT INTO booking_blocks (shop_id, block_date, start_hour, end_hour, is_full_day, note)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, block_date, start_hour, end_hour, is_full_day, note, created_at
      `,
      [
        shopId,
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

router.post('/blocks/bulk', async (req, res) => {
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
    const shopId = req.shop.id
    const result = await withTransaction(async (client) => {
      let created = 0
      let skipped = 0

      for (const blockDate of dates) {
        if (fullDay) {
          const exists = await client.query(
            `SELECT 1 FROM booking_blocks WHERE shop_id = $1 AND block_date = $2 AND is_full_day = true LIMIT 1`,
            [shopId, blockDate]
          )
          if (exists.rows.length > 0) {
            skipped += 1
            continue
          }
        } else {
          const exists = await client.query(
            `
              SELECT 1 FROM booking_blocks
              WHERE shop_id = $1
                AND block_date = $2
                AND (
                  is_full_day = true
                  OR (is_full_day = false AND start_hour = $3 AND end_hour = $4)
                )
              LIMIT 1
            `,
            [shopId, blockDate, startH, endH]
          )
          if (exists.rows.length > 0) {
            skipped += 1
            continue
          }
        }

        await client.query(
          `
            INSERT INTO booking_blocks (shop_id, block_date, start_hour, end_hour, is_full_day, note)
            VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [shopId, blockDate, startH, endH, fullDay, blockNote]
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

router.delete('/blocks/:id', async (req, res) => {
  try {
    const pool = getPool()
    const shopId = req.shop.id
    const result = await pool.query(
      `DELETE FROM booking_blocks WHERE id = $1 AND shop_id = $2`,
      [req.params.id, shopId]
    )

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'ไม่พบรายการปิดวันเวลา' })
    }
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/extra-hours', async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7)
  const [y, m] = month.split('-').map(Number)
  if (!y || !m) return res.status(400).json({ error: 'month ต้องเป็น YYYY-MM' })

  const fromDate = new Date(y, m - 1, 1)
  const toDate = new Date(y, m, 0)
  const from = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}-${String(fromDate.getDate()).padStart(2, '0')}`
  const to = `${toDate.getFullYear()}-${String(toDate.getMonth() + 1).padStart(2, '0')}-${String(toDate.getDate()).padStart(2, '0')}`

  try {
    const pool = getPool()
    const shopId = req.shop.id
    const result = await pool.query(
      `
        SELECT id, extra_date, start_hour, end_hour, note, created_at
        FROM booking_extra_hours
        WHERE shop_id = $1 AND extra_date BETWEEN $2 AND $3
        ORDER BY extra_date ASC, start_hour ASC
      `,
      [shopId, from, to]
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/extra-hours', async (req, res) => {
  const { extra_date, start_hour, end_hour, note } = req.body
  if (!extra_date) return res.status(400).json({ error: 'ต้องระบุ extra_date' })
  if (start_hour == null || end_hour == null) {
    return res.status(400).json({ error: 'ต้องระบุ start_hour และ end_hour' })
  }
  if (start_hour < 0 || end_hour > 24 || end_hour <= start_hour) {
    return res.status(400).json({ error: 'ช่วงเวลาเปิดเพิ่มไม่ถูกต้อง' })
  }

  try {
    const pool = getPool()
    const shopId = req.shop.id
    const slotHours = await getBookingSlotHours(pool, shopId)
    if (end_hour - start_hour < slotHours) {
      return res.status(400).json({
        error: `ช่วงเปิดเพิ่มต้องยาวอย่างน้อย ${slotHours} ชั่วโมง (ตามความยาวคิว)`,
      })
    }
    const result = await pool.query(
      `
        INSERT INTO booking_extra_hours (shop_id, extra_date, start_hour, end_hour, note)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, extra_date, start_hour, end_hour, note, created_at
      `,
      [shopId, extra_date, start_hour, end_hour, note || null]
    )
    res.status(201).json({ success: true, extra: result.rows[0] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/extra-hours/:id', async (req, res) => {
  try {
    const pool = getPool()
    const shopId = req.shop.id
    const result = await pool.query(
      `DELETE FROM booking_extra_hours WHERE id = $1 AND shop_id = $2`,
      [req.params.id, shopId]
    )

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'ไม่พบรายการเปิดเพิ่ม' })
    }
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/settings/deposit', async (req, res) => {
  try {
    const pool = getPool()
    const value = await getShopSetting(pool, req.shop.id, 'deposit_amount')
    res.json({ deposit_amount: Number(value) || 300 })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.patch('/settings/deposit', async (req, res) => {
  const amount = Number(req.body?.deposit_amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'deposit_amount ต้องมากกว่า 0' })
  }

  try {
    const pool = getPool()
    await setShopSetting(pool, req.shop.id, 'deposit_amount', amount)
    res.json({ success: true, deposit_amount: amount })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/settings/coupon', async (req, res) => {
  try {
    const pool = getPool()
    const settings = await getCouponSettings(pool, req.shop.id)
    res.json({
      discount_percent: settings.discountPercent,
      required_points: settings.requiredPoints,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.patch('/settings/coupon', async (req, res) => {
  const discountPercent = Number(req.body?.discount_percent)
  const requiredPoints = Number(req.body?.required_points)
  if (!Number.isInteger(discountPercent) || discountPercent < 1 || discountPercent > 100) {
    return res.status(400).json({ error: 'discount_percent ต้องอยู่ระหว่าง 1-100' })
  }
  if (!Number.isInteger(requiredPoints) || requiredPoints < 1) {
    return res.status(400).json({ error: 'required_points ต้องมากกว่า 0' })
  }
  try {
    const pool = getPool()
    const settings = await setCouponSettings(pool, req.shop.id, { discountPercent, requiredPoints })
    res.json({
      success: true,
      discount_percent: settings.discountPercent,
      required_points: settings.requiredPoints,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/settings/line-push', async (req, res) => {
  try {
    const pool = getPool()
    const settings = await getLinePushSettings(pool, req.shop.id)
    res.json({
      enabled: settings.pushEnabledFlag,
      push_to_id: settings.pushToId,
      token_masked: settings.tokenMasked,
      token_configured: settings.tokenConfigured,
      token_from_env: settings.tokenFromEnv,
      notify_template: settings.notifyTemplate,
      default_template: LINE_NOTIFY_DEFAULT_TEMPLATE,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.patch('/settings/line-push', async (req, res) => {
  try {
    const pool = getPool()
    const partial = {}
    if (typeof req.body?.enabled === 'boolean') partial.enabled = req.body.enabled
    if (req.body?.push_to_id != null) partial.pushToId = req.body.push_to_id
    if (req.body?.notify_template != null) partial.notifyTemplate = req.body.notify_template
    if (req.body?.channel_access_token != null && !process.env.LINE_BOT_CHANNEL_ACCESS_TOKEN) {
      partial.channelAccessToken = req.body.channel_access_token
    }
    const settings = await setLinePushSettings(pool, req.shop.id, partial)
    res.json({
      success: true,
      enabled: settings.pushEnabledFlag,
      push_to_id: settings.pushToId,
      token_masked: settings.tokenMasked,
      token_configured: settings.tokenConfigured,
      token_from_env: settings.tokenFromEnv,
      notify_template: settings.notifyTemplate,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/settings/line-push/test', async (req, res) => {
  try {
    const pool = getPool()
    const shopId = req.shop.id
    const testMessage = req.body?.message
      || `✅ ทดสอบแจ้งเตือน LINE จาก ${req.shop.name}\nเวลา: ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`
    const result = await notifyShopNewBooking(pool, shopId, null, {
      test: true,
      testMessage,
    })
    if (result.skipped) {
      return res.status(400).json({
        error: 'ยังตั้งค่า LINE ไม่ครบ — เปิดใช้งาน Channel Access Token และ User/Group ID',
      })
    }
    if (!result.ok) {
      if (result.status === 401) {
        return res.status(502).json({
          error: 'Channel Access Token ไม่ถูกต้อง — กด Issue ใหม่ที่ LINE Developers แล้วอัปเดตใน Render (LINE_BOT_CHANNEL_ACCESS_TOKEN) หรือแอดมิน (อย่าใส่ Channel secret)',
        })
      }
      return res.status(502).json({
        error: result.error || 'ส่ง LINE ไม่สำเร็จ ตรวจสอบ Token และ User/Group ID',
      })
    }
    res.json({ success: true, message: 'ส่งข้อความทดสอบแล้ว' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/settings/unpaid-auto-cancel', async (req, res) => {
  try {
    const pool = getPool()
    const settings = await getUnpaidExpireSettings(pool, req.shop.id)
    res.json({
      enabled: settings.enabled,
      expire_hours: settings.expireHours,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.patch('/settings/unpaid-auto-cancel', async (req, res) => {
  const enabled = req.body?.enabled !== false && req.body?.enabled !== 'false'
  const hours = Number(req.body?.expire_hours)
  if (!Number.isInteger(hours) || hours < MIN_HOURS || hours > MAX_HOURS) {
    return res.status(400).json({
      error: `expire_hours ต้องเป็นจำนวนเต็มระหว่าง ${MIN_HOURS}-${MAX_HOURS}`,
    })
  }

  try {
    const pool = getPool()
    await setShopSettings(pool, req.shop.id, {
      unpaid_auto_cancel_enabled: enabled ? 'true' : 'false',
      unpaid_expire_hours: String(hours),
    })
    res.json({ success: true, enabled, expire_hours: hours })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/settings/shop-hours', async (req, res) => {
  try {
    const pool = getPool()
    const hours = await getShopHours(pool, req.shop.id)
    res.json({
      open_hour: hours.openHour,
      last_booking_hour: hours.lastBookingHour,
      slot_hours: hours.slotHours,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.patch('/settings/shop-hours', async (req, res) => {
  const open = Number(req.body?.open_hour)
  const last = Number(req.body?.last_booking_hour)
  if (!Number.isInteger(open) || open < 1 || open > 20)
    return res.status(400).json({ error: 'open_hour ต้องอยู่ระหว่าง 1-20' })
  try {
    const pool = getPool()
    const slotHours = await getBookingSlotHours(pool, req.shop.id)
    if (!Number.isInteger(last) || last < open + slotHours || last > 22) {
      return res.status(400).json({
        error: `last_booking_hour ต้องมากกว่า open_hour อย่างน้อย ${slotHours} และไม่เกิน 22`,
      })
    }
    await setShopSettings(pool, req.shop.id, {
      shop_open_hour: String(open),
      shop_last_booking_hour: String(last),
    })
    res.json({ success: true, open_hour: open, last_booking_hour: last })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/settings/advance-days', async (req, res) => {
  try {
    const pool = getPool()
    const settings = await getAdvanceSettings(pool, req.shop.id)
    res.json({
      advance_days: settings.advanceDays,
      book_until_date: settings.bookUntilDate,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.patch('/settings/advance-days', async (req, res) => {
  const days = Number(req.body?.advance_days)
  if (!Number.isInteger(days) || days < 1 || days > 365)
    return res.status(400).json({ error: 'advance_days ต้องอยู่ระหว่าง 1-365' })
  try {
    const pool = getPool()
    const bookUntil = computeBookUntilDate(days, todayYmdBangkok())
    await setShopSettings(pool, req.shop.id, {
      book_advance_days: String(days),
      book_until_date: bookUntil,
    })
    res.json({ success: true, advance_days: days, book_until_date: bookUntil })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/settings/booking-display', async (req, res) => {
  try {
    const pool = getPool()
    const value = await getShopSetting(pool, req.shop.id, 'booking_display_mode')
    const mode = value === 'slots_2h' ? 'slots_2h' : 'normal'
    res.json({ display_mode: mode })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.patch('/settings/booking-display', async (req, res) => {
  const mode = req.body?.display_mode === 'slots_2h' ? 'slots_2h' : 'normal'
  try {
    const pool = getPool()
    await setShopSetting(pool, req.shop.id, 'booking_display_mode', mode)
    res.json({ success: true, display_mode: mode })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/settings/booking-slot-hours', async (req, res) => {
  try {
    const pool = getPool()
    const slotHours = await getBookingSlotHours(pool, req.shop.id)
    res.json({ slot_hours: slotHours })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.patch('/settings/booking-slot-hours', async (req, res) => {
  const slotHours = normalizeBookingSlotHours(req.body?.slot_hours)
  try {
    const pool = getPool()
    await setShopSetting(pool, req.shop.id, 'booking_slot_hours', String(slotHours))
    res.json({ success: true, slot_hours: slotHours })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/settings/ui', async (req, res) => {
  try {
    const pool = getPool()
    const settings = await getUiSettings(pool, req.shop.id)
    res.json(settings)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.patch('/settings/ui', async (req, res) => {
  try {
    const pool = getPool()
    const settings = await setUiSettings(pool, req.shop.id, req.body || {})
    res.json({ success: true, settings })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.patch('/coupons/use', async (req, res) => {
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

router.patch('/bookings/:id/confirm-payment', async (req, res) => {
  try {
    const pool = getPool()
    const shopId = req.shop.id
    await expireUnpaidBookings(pool, shopId)
    const settings = await getUnpaidExpireSettings(pool, shopId)

    const found = await pool.query(
      `SELECT id, status, created_at FROM bookings WHERE id = $1 AND shop_id = $2`,
      [req.params.id, shopId]
    )
    const row = found.rows[0]
    if (!row || row.status !== 'awaiting_payment') {
      return res.status(404).json({ error: 'ไม่พบคิวที่รอยืนยันชำระเงิน' })
    }

    if (isBookingExpired(row.created_at, settings.expireHours, settings.enabled)) {
      await pool.query(
        `UPDATE bookings SET status = 'cancelled' WHERE id = $1 AND shop_id = $2 AND status = 'awaiting_payment'`,
        [req.params.id, shopId]
      )
      return res.status(409).json({ error: 'คิวหมดเวลาชำระแล้ว ถูกยกเลิกอัตโนมัติ' })
    }

    const result = await pool.query(
      `
        UPDATE bookings
        SET status = 'pending'
        WHERE id = $1
          AND shop_id = $2
          AND status = 'awaiting_payment'
      `,
      [req.params.id, shopId]
    )

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'ไม่พบคิวที่รอยืนยันชำระเงิน' })
    }

    res.json({ success: true, message: 'ยืนยันชำระเงินแล้ว คิวพร้อมให้บริการ' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.patch('/bookings/:id/revert-payment', async (req, res) => {
  try {
    const shopId = req.shop.id
    const result = await getPool().query(
      `
        UPDATE bookings
        SET
          status = 'awaiting_payment',
          created_at = NOW()
        WHERE id = $1
          AND shop_id = $2
          AND status = 'pending'
      `,
      [req.params.id, shopId]
    )

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'ไม่พบคิวที่ชำระแล้ว / รอให้บริการ' })
    }

    res.json({
      success: true,
      message: 'เปลี่ยนเป็นรอชำระเงินแล้ว · เริ่มนับเวลาชำระใหม่',
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.patch('/bookings/:id/complete', async (req, res) => {
  const total = Number(req.body?.total)
  if (!Number.isFinite(total) || total < 0) {
    return res.status(400).json({ error: 'กรุณาระบุยอดเงินที่ถูกต้อง' })
  }

  try {
    const shopId = req.shop.id
    await withTransaction(async (client) => {
      const found = await client.query(
        `SELECT * FROM bookings WHERE id = $1 AND shop_id = $2 AND status = 'pending'`,
        [req.params.id, shopId]
      )
      if (!found.rows[0]) {
        const err = new Error('ไม่พบคิว หรือทำเสร็จแล้ว')
        err.status = 404
        throw err
      }
      const booking = found.rows[0]

      await client.query(
        `UPDATE bookings SET status = 'done', completed_at = NOW(), total = $3 WHERE id = $1 AND shop_id = $2`,
        [booking.id, shopId, total]
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

router.patch('/bookings/:id', async (req, res) => {
  if (!('total' in req.body)) {
    return res.status(400).json({ error: 'กรุณาระบุยอดเงิน' })
  }
  const total = Number(req.body.total)
  if (!Number.isFinite(total) || total < 0) {
    return res.status(400).json({ error: 'ยอดเงินไม่ถูกต้อง' })
  }

  const hasOptions = 'nailoption_ids' in req.body
  if (hasOptions && !Array.isArray(req.body.nailoption_ids)) {
    return res.status(400).json({ error: 'nailoption_ids ต้องเป็น array' })
  }

  const hasUserId = 'user_id' in req.body
  const userId = hasUserId ? req.body.user_id : null
  if (hasUserId && !userId) {
    return res.status(400).json({ error: 'กรุณาเลือกลูกค้า' })
  }

  const hasStartHour = 'start_hour' in req.body
  const startHourNum = hasStartHour ? Number(req.body.start_hour) : null
  if (hasStartHour && !Number.isInteger(startHourNum)) {
    return res.status(400).json({ error: 'start_hour ไม่ถูกต้อง' })
  }

  const hasBookingDate = 'booking_date' in req.body
  const bookingDate = hasBookingDate ? String(req.body.booking_date) : null
  if (hasBookingDate && !/^\d{4}-\d{2}-\d{2}$/.test(bookingDate)) {
    return res.status(400).json({ error: 'รูปแบบวันที่ไม่ถูกต้อง' })
  }

  try {
    const shopId = req.shop.id
    const booking = await withTransaction(async (client) => {
      const existing = await client.query(
        `SELECT id, booking_date, start_hour, status FROM bookings WHERE id = $1 AND shop_id = $2 FOR UPDATE`,
        [req.params.id, shopId]
      )
      if (existing.rowCount === 0) throw { status: 404, message: 'ไม่พบคิว' }
      const row = existing.rows[0]
      if (row.status === 'cancelled') {
        throw { status: 404, message: 'ไม่พบคิว หรือไม่สามารถแก้ไขได้' }
      }

      const effectiveDate = hasBookingDate ? bookingDate : String(row.booking_date).slice(0, 10)
      const effectiveStartHour = hasStartHour ? startHourNum : Number(row.start_hour)
      const dateChanged = hasBookingDate && bookingDate !== String(row.booking_date).slice(0, 10)
      const hourChanged = hasStartHour && startHourNum !== Number(row.start_hour)

      if (hasUserId) {
        const userRes = await client.query(`SELECT id FROM users WHERE id = $1`, [userId])
        if (!userRes.rows.length) {
          throw { status: 400, message: 'ไม่พบลูกค้าที่เลือก' }
        }
      }

      const optionIds = hasOptions ? normalizeOptionIds(req.body.nailoption_ids) : null
      if (optionIds !== null) {
        if (!optionIds.length) {
          throw { status: 400, message: 'กรุณาเลือกบริการอย่างน้อย 1 รายการ' }
        }
        const isValidOptions = await validateOptionIds(client, shopId, optionIds, null)
        if (!isValidOptions) {
          throw { status: 400, message: 'รายการบริการที่เลือกไม่ถูกต้อง' }
        }
        const requiredError = await validateRequiredOptions(client, shopId, optionIds, effectiveDate)
        if (requiredError) {
          throw { status: 400, message: requiredError }
        }
      }

      const slotHours = await getBookingSlotHours(client, shopId)

      if (hasStartHour || hasBookingDate) {
        const hourError = await validateBookingStartHour(
          client,
          shopId,
          effectiveDate,
          effectiveStartHour,
          slotHours
        )
        if (hourError) {
          throw { status: 400, message: hourError }
        }
        await assertSlotNotBlocked(client, shopId, effectiveDate, effectiveStartHour)
        if (dateChanged || hourChanged) {
          await assertSlotAvailable(client, shopId, effectiveDate, effectiveStartHour, req.params.id)
        }
      }

      const updates = ['total = $1']
      const params = [total]
      let paramIdx = 2

      if (hasUserId) {
        updates.push(`user_id = $${paramIdx}`)
        params.push(userId)
        paramIdx += 1
      }

      if (hasBookingDate) {
        updates.push(`booking_date = $${paramIdx}`)
        params.push(bookingDate)
        paramIdx += 1
      }

      if (hasStartHour) {
        updates.push(`start_hour = $${paramIdx}`)
        params.push(startHourNum)
        paramIdx += 1
        updates.push(`end_hour = $${paramIdx}`)
        params.push(bookingEndHour(startHourNum, slotHours))
        paramIdx += 1
      } else if (hasBookingDate) {
        updates.push(`end_hour = $${paramIdx}`)
        params.push(bookingEndHour(effectiveStartHour, slotHours))
        paramIdx += 1
      }

      params.push(req.params.id, shopId)
      const idParam = paramIdx
      const shopParam = paramIdx + 1

      const result = await client.query(
        `
          UPDATE bookings
          SET ${updates.join(', ')}
          WHERE id = $${idParam}
            AND shop_id = $${shopParam}
            AND status != 'cancelled'
          RETURNING id, user_id, booking_date, start_hour, end_hour, status, total, created_at, completed_at
        `,
        params
      )

      if (optionIds !== null) {
        await syncBookingOptions(client, req.params.id, optionIds)
      }

      const optionsResult = await client.query(
        `
          SELECT n.id, n.option_name
          FROM booking_nailoptions bn
          JOIN nailoption n ON n.id = bn.nailoption_id
          WHERE bn.booking_id = $1
          ORDER BY n.option_name ASC
        `,
        [req.params.id]
      )

      return {
        ...result.rows[0],
        nail_options: optionsResult.rows.map((o) => ({
          id: o.id,
          option_name: o.option_name,
        })),
      }
    })

    res.json({ success: true, message: 'บันทึกแล้ว', booking })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    if (err.code === '23505') {
      return res.status(409).json({ error: 'เวลานี้ถูกจองแล้ว กรุณาเลือกเวลาอื่น' })
    }
    res.status(500).json({ error: err.message })
  }
})

router.get('/users', async (req, res) => {
  try {
    const pool = getPool()
    const shopId = req.shop.id
    const result = await pool.query(
      `
      SELECT
        u.id, u.name, u.email, u.avatar_url, u.provider, u.provider_id, u.admin_note,
        u.is_admin, u.total_points, u.created_at,
        COUNT(b.id)::int AS total_bookings,
        SUM(CASE WHEN b.status = 'done' THEN 1 ELSE 0 END)::int AS completed_bookings,
        SUM(CASE WHEN b.status = 'cancelled' THEN 1 ELSE 0 END)::int AS cancelled_bookings,
        (
          SELECT bool_or(s.slug = 'default')
          FROM shop_admins sa
          JOIN shops s ON s.id = sa.shop_id
          WHERE sa.user_id = u.id
        ) AS is_super_admin,
        (
          SELECT s.slug
          FROM shop_admins sa
          JOIN shops s ON s.id = sa.shop_id
          WHERE sa.user_id = u.id
          ORDER BY CASE WHEN s.slug = 'default' THEN 0 ELSE 1 END, s.slug
          LIMIT 1
        ) AS admin_shop_slug
      FROM users u
      LEFT JOIN bookings b ON b.user_id = u.id AND b.shop_id = $1
      GROUP BY u.id, u.name, u.email, u.avatar_url, u.provider, u.provider_id, u.admin_note, u.is_admin, u.total_points, u.created_at
      ORDER BY u.is_admin DESC, u.total_points DESC
    `,
      [shopId]
    )
    res.json(result.rows.map((row) => ({
      ...row,
      is_super_admin: Boolean(row.is_super_admin),
      admin_shop_slug: row.is_admin ? (row.admin_shop_slug || null) : null,
    })))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/users/:id/bookings', async (req, res) => {
  try {
    const pool = getPool()
    const shopId = req.shop.id
    const userRes = await pool.query(
      `SELECT id, name, email, provider, provider_id, total_points, created_at FROM users WHERE id = $1`,
      [req.params.id]
    )
    if (!userRes.rows[0]) {
      return res.status(404).json({ error: 'ไม่พบผู้ใช้' })
    }

    const bookingsRes = await pool.query(
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
        WHERE b.user_id = $1 AND b.shop_id = $2
        ORDER BY b.booking_date DESC, b.start_hour DESC
      `,
      [req.params.id, shopId]
    )

    const optionsRes = await pool.query(
      `
        SELECT b.id AS booking_id, n.id AS option_id, n.option_name
        FROM bookings b
        JOIN booking_nailoptions bn ON bn.booking_id = b.id
        JOIN nailoption n ON n.id = bn.nailoption_id
        WHERE b.user_id = $1 AND b.shop_id = $2
        ORDER BY b.booking_date DESC, b.start_hour DESC, n.option_name ASC
      `,
      [req.params.id, shopId]
    )

    const optionsByBookingId = {}
    for (const row of optionsRes.rows) {
      if (!optionsByBookingId[row.booking_id]) optionsByBookingId[row.booking_id] = []
      optionsByBookingId[row.booking_id].push({
        id: row.option_id,
        option_name: row.option_name,
      })
    }

    res.json({
      user: userRes.rows[0],
      bookings: bookingsRes.rows.map((item) => ({
        ...item,
        nail_options: optionsByBookingId[item.id] || [],
      })),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.patch('/users/:id/set-admin', async (req, res) => {
  const { is_admin, admin_shop_slug } = req.body
  if (req.params.id === req.user.id && !is_admin) {
    return res.status(400).json({ error: 'ไม่สามารถถอดสิทธิ์แอดมินของตัวเองได้' })
  }
  if (Boolean(is_admin) && !req.isSuperAdmin) {
    return res.status(403).json({ error: 'เฉพาะแอดมินหลักเท่านั้นที่ให้สิทธิ์แอดมินได้' })
  }
  const slug = String(admin_shop_slug || 'default').trim().toLowerCase()
  if (Boolean(is_admin) && slug === 'default' && !req.isSuperAdmin) {
    return res.status(403).json({ error: 'เฉพาะแอดมินหลักเท่านั้นที่ตั้งแอดมินทุกสาขาได้' })
  }
  try {
    await withTransaction(async (client) => {
      await client.query(`UPDATE users SET is_admin = $1 WHERE id = $2`, [Boolean(is_admin), req.params.id])
      await syncShopAdminAssignment(client, req.params.id, {
        isAdmin: Boolean(is_admin),
        adminShopSlug: slug,
      })
    })
    res.json({ success: true, admin_shop_slug: Boolean(is_admin) ? slug : null })
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
})

router.patch('/users/:id', async (req, res) => {
  const has = (key) => Object.prototype.hasOwnProperty.call(req.body, key)
  const fields = []
  const params = []

  if (has('name')) {
    const name = String(req.body.name || '').trim()
    if (!name) return res.status(400).json({ error: 'กรุณาระบุชื่อ' })
    params.push(name)
    fields.push(`name = $${params.length}`)
  }

  if (has('email')) {
    const email = String(req.body.email || '').trim()
    if (!email) return res.status(400).json({ error: 'กรุณาระบุอีเมล' })
    params.push(email)
    fields.push(`email = $${params.length}`)
  }

  if (has('total_points')) {
    const totalPoints = Number(req.body.total_points)
    if (!Number.isInteger(totalPoints) || totalPoints < 0) {
      return res.status(400).json({ error: 'แต้มต้องเป็นจำนวนเต็มที่ไม่ติดลบ' })
    }
    params.push(totalPoints)
    fields.push(`total_points = $${params.length}`)
  }

  if (has('admin_note')) {
    const adminNote = String(req.body.admin_note || '').trim() || null
    params.push(adminNote)
    fields.push(`admin_note = $${params.length}`)
  }

  if (has('is_admin')) {
    if (req.params.id === req.user.id && !req.body.is_admin) {
      return res.status(400).json({ error: 'ไม่สามารถถอดสิทธิ์แอดมินของตัวเองได้' })
    }
    params.push(Boolean(req.body.is_admin))
    fields.push(`is_admin = $${params.length}`)
  }

  if (!fields.length && !has('login_id') && !has('admin_shop_slug')) {
    return res.status(400).json({ error: 'ไม่มีข้อมูลให้แก้ไข' })
  }

  if (has('admin_shop_slug') || (has('is_admin') && req.body.is_admin)) {
    const slug = String(req.body.admin_shop_slug || 'default').trim().toLowerCase()
    if (slug === 'default' && !req.isSuperAdmin) {
      return res.status(403).json({ error: 'เฉพาะแอดมินหลักเท่านั้นที่ตั้งแอดมินทุกสาขาได้' })
    }
    if ((has('admin_shop_slug') || req.body.is_admin) && !req.isSuperAdmin) {
      return res.status(403).json({ error: 'เฉพาะแอดมินหลักเท่านั้นที่จัดการสิทธิ์แอดมินได้' })
    }
  }

  try {
    const pool = getPool()
    const existing = await pool.query(
      `SELECT provider, provider_id, email FROM users WHERE id = $1`,
      [req.params.id]
    )
    if (!existing.rows.length) {
      return res.status(404).json({ error: 'ไม่พบผู้ใช้' })
    }
    const current = existing.rows[0]

    if (has('login_id')) {
      if (current.provider !== 'phone') {
        return res.status(400).json({ error: 'แก้ไขรหัสล็อกอินได้เฉพาะบัญชีเบอร์โทร' })
      }
      const phone = normalizePhone(req.body.login_id)
      if (!phone) {
        return res.status(400).json({ error: 'กรุณาระบุเบอร์โทร' })
      }
      const dup = await pool.query(
        `SELECT id FROM users WHERE provider = 'phone' AND provider_id = $1 AND id != $2 LIMIT 1`,
        [phone, req.params.id]
      )
      if (dup.rows.length) {
        return res.status(409).json({ error: 'เบอร์โทรนี้ถูกใช้แล้ว' })
      }
      params.push(phone)
      fields.push(`provider_id = $${params.length}`)
      if (!has('email') && String(current.email || '').endsWith('@phone.local')) {
        params.push(`${phone}@phone.local`)
        fields.push(`email = $${params.length}`)
      }
    }

    if (!fields.length) {
      if (!has('admin_shop_slug')) {
        return res.status(400).json({ error: 'ไม่มีข้อมูลให้แก้ไข' })
      }
      const current = await pool.query(`SELECT is_admin FROM users WHERE id = $1`, [req.params.id])
      if (!current.rows[0]?.is_admin) {
        return res.status(400).json({ error: 'ผู้ใช้นี้ยังไม่ใช่แอดมิน' })
      }
      await syncShopAdminAssignment(pool, req.params.id, {
        isAdmin: true,
        adminShopSlug: req.body.admin_shop_slug || 'default',
      })
      const shopId = req.shop.id
      const stats = await pool.query(
        `
          SELECT
            COUNT(*)::int AS total_bookings,
            SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END)::int AS completed_bookings,
            SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END)::int AS cancelled_bookings
          FROM bookings
          WHERE user_id = $1 AND shop_id = $2
        `,
        [req.params.id, shopId]
      )
      const fullUser = await pool.query(
        `SELECT id, name, email, avatar_url, provider, provider_id, admin_note, is_admin, total_points, created_at
         FROM users WHERE id = $1`,
        [req.params.id]
      )
      const enriched = await attachAdminShopFields(pool, fullUser.rows[0])
      return res.json({
        success: true,
        user: {
          ...enriched,
          total_bookings: stats.rows[0]?.total_bookings || 0,
          completed_bookings: stats.rows[0]?.completed_bookings || 0,
          cancelled_bookings: stats.rows[0]?.cancelled_bookings || 0,
        },
      })
    }

    params.push(req.params.id)

    const result = await pool.query(
      `
        UPDATE users
        SET ${fields.join(', ')}
        WHERE id = $${params.length}
        RETURNING id, name, email, avatar_url, provider, provider_id, admin_note, is_admin, total_points, created_at
      `,
      params
    )

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'ไม่พบผู้ใช้' })
    }

    const userId = req.params.id
    if (has('is_admin') || has('admin_shop_slug')) {
      const adminFlag = has('is_admin') ? Boolean(req.body.is_admin) : result.rows[0].is_admin
      if (adminFlag) {
        await syncShopAdminAssignment(pool, userId, {
          isAdmin: true,
          adminShopSlug: req.body.admin_shop_slug || 'default',
        })
      } else if (has('is_admin')) {
        await pool.query(`DELETE FROM shop_admins WHERE user_id = $1`, [userId])
      }
    }

    const user = result.rows[0]
    const shopId = req.shop.id
    const stats = await pool.query(
      `
        SELECT
          COUNT(*)::int AS total_bookings,
          SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END)::int AS completed_bookings,
          SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END)::int AS cancelled_bookings
        FROM bookings
        WHERE user_id = $1 AND shop_id = $2
      `,
      [user.id, shopId]
    )

    const enriched = await attachAdminShopFields(pool, user)

    res.json({
      success: true,
      user: {
        ...enriched,
        total_bookings: stats.rows[0]?.total_bookings || 0,
        completed_bookings: stats.rows[0]?.completed_bookings || 0,
        cancelled_bookings: stats.rows[0]?.cancelled_bookings || 0,
      },
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/users/:id', async (req, res) => {
  const userId = req.params.id
  if (userId === req.user.id) {
    return res.status(400).json({ error: 'ไม่สามารถลบบัญชีของตัวเองได้' })
  }
  try {
    const shopId = req.shop.id
    await withTransaction(async (client) => {
      const userRes = await client.query(
        `SELECT id, is_admin FROM users WHERE id = $1`,
        [userId]
      )
      if (!userRes.rows.length) {
        const err = new Error('ไม่พบผู้ใช้')
        err.status = 404
        throw err
      }
      if (userRes.rows[0].is_admin) {
        const err = new Error('ไม่สามารถลบบัญชีแอดมินได้')
        err.status = 400
        throw err
      }
      await client.query(
        `DELETE FROM point_logs WHERE user_id = $1 AND booking_id IN (SELECT id FROM bookings WHERE user_id = $1 AND shop_id = $2)`,
        [userId, shopId]
      )
      await client.query(
        `DELETE FROM booking_nailoptions
         WHERE booking_id IN (SELECT id FROM bookings WHERE user_id = $1 AND shop_id = $2)`,
        [userId, shopId]
      )
      await client.query(`DELETE FROM bookings WHERE user_id = $1 AND shop_id = $2`, [userId, shopId])
      await client.query(`DELETE FROM coupons WHERE user_id = $1`, [userId])
      await client.query(`DELETE FROM users WHERE id = $1`, [userId])
    })
    res.json({ success: true })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
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

function parseOptionalColor(value) {
  if (value == null || value === '') return null
  const color = String(value).trim()
  if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
    return { error: 'color ต้องเป็นรูปแบบ #RRGGBB' }
  }
  return color
}

router.get('/nailoptions', async (req, res) => {
  try {
    const pool = getPool()
    const shopId = req.shop.id
    const result = await pool.query(
      `
      SELECT id, option_name, description, price, duration_min, is_active, is_required, color,
             show_from_date, show_to_date, sort_order, created_at, updated_at
      FROM nailoption
      WHERE shop_id = $1
      ORDER BY sort_order ASC, created_at ASC, option_name ASC
    `,
      [shopId]
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/nailoptions', async (req, res) => {
  const option_name = String(req.body?.option_name || '').trim()
  const description = String(req.body?.description || '').trim() || null
  const price = Number(req.body?.price)
  const duration_min = Number(req.body?.duration_min)
  const is_active = req.body?.is_active !== false
  const is_required = Boolean(req.body?.is_required)
  const showFromParsed = parseOptionalDate(req.body?.show_from_date)
  const showToParsed = parseOptionalDate(req.body?.show_to_date)
  const colorParsed = parseOptionalColor(req.body?.color)

  if (!option_name) return res.status(400).json({ error: 'กรุณาระบุชื่อบริการ' })
  if (!Number.isFinite(price) || price < 0) {
    return res.status(400).json({ error: 'ราคาไม่ถูกต้อง' })
  }
  if (!Number.isFinite(duration_min) || duration_min <= 0) {
    return res.status(400).json({ error: 'ระยะเวลา (นาที) ต้องมากกว่า 0' })
  }
  if (showFromParsed?.error) return res.status(400).json({ error: showFromParsed.error })
  if (showToParsed?.error) return res.status(400).json({ error: showToParsed.error })
  if (colorParsed?.error) return res.status(400).json({ error: colorParsed.error })
  const rangeError = validateShowDateRange(showFromParsed, showToParsed)
  if (rangeError) return res.status(400).json(rangeError)

  try {
    const pool = getPool()
    const shopId = req.shop.id
    const orderRes = await pool.query(
      `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM nailoption WHERE shop_id = $1`,
      [shopId]
    )
    const sort_order = Number(orderRes.rows[0]?.next_order) || 1
    const result = await pool.query(
      `
        INSERT INTO nailoption (
          shop_id, option_name, description, price, duration_min, is_active, is_required, color,
          show_from_date, show_to_date, sort_order
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id, option_name, description, price, duration_min, is_active, is_required, color,
                  show_from_date, show_to_date, sort_order, created_at, updated_at
      `,
      [shopId, option_name, description, price, duration_min, is_active, is_required, colorParsed, showFromParsed, showToParsed, sort_order]
    )
    res.status(201).json({ success: true, option: result.rows[0] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.patch('/nailoptions/:id', async (req, res) => {
  const option_name = String(req.body?.option_name || '').trim()
  const description = String(req.body?.description || '').trim() || null
  const price = Number(req.body?.price)
  const duration_min = Number(req.body?.duration_min)
  const is_active = Boolean(req.body?.is_active)
  const is_required = Boolean(req.body?.is_required)
  const showFromParsed = parseOptionalDate(req.body?.show_from_date)
  const showToParsed = parseOptionalDate(req.body?.show_to_date)
  const colorParsed = parseOptionalColor(req.body?.color)

  if (!option_name) return res.status(400).json({ error: 'กรุณาระบุชื่อบริการ' })
  if (!Number.isFinite(price) || price < 0) {
    return res.status(400).json({ error: 'ราคาไม่ถูกต้อง' })
  }
  if (!Number.isFinite(duration_min) || duration_min <= 0) {
    return res.status(400).json({ error: 'ระยะเวลา (นาที) ต้องมากกว่า 0' })
  }
  if (showFromParsed?.error) return res.status(400).json({ error: showFromParsed.error })
  if (showToParsed?.error) return res.status(400).json({ error: showToParsed.error })
  if (colorParsed?.error) return res.status(400).json({ error: colorParsed.error })
  const rangeError = validateShowDateRange(showFromParsed, showToParsed)
  if (rangeError) return res.status(400).json(rangeError)

  try {
    const pool = getPool()
    const shopId = req.shop.id
    const result = await pool.query(
      `
        UPDATE nailoption
        SET
          option_name = $1,
          description = $2,
          price = $3,
          duration_min = $4,
          is_active = $5,
          is_required = $6,
          color = $7,
          show_from_date = $8,
          show_to_date = $9,
          updated_at = NOW()
        WHERE id = $10 AND shop_id = $11
        RETURNING id, option_name, description, price, duration_min, is_active, is_required, color,
                  show_from_date, show_to_date, sort_order, created_at, updated_at
      `,
      [option_name, description, price, duration_min, is_active, is_required, colorParsed, showFromParsed, showToParsed, req.params.id, shopId]
    )

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'ไม่พบรายการบริการ' })
    }

    res.json({ success: true, option: result.rows[0] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.patch('/nailoptions/:id/move', async (req, res) => {
  const direction = req.body?.direction === 'down' ? 'down' : 'up'
  const scopeDate = req.body?.date
  const scopeEveryDay = req.body?.scope === 'everyday'

  if (scopeDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(scopeDate))) {
    return res.status(400).json({ error: 'date ต้องเป็น YYYY-MM-DD' })
  }

  try {
    const shopId = req.shop.id
    await withTransaction(async (client) => {
      let listRes
      if (scopeEveryDay) {
        listRes = await client.query(
          `
            SELECT id, sort_order
            FROM nailoption
            WHERE shop_id = $1 AND show_from_date IS NULL AND show_to_date IS NULL
            ORDER BY sort_order ASC, created_at ASC, option_name ASC
            FOR UPDATE
          `,
          [shopId]
        )
      } else if (scopeDate) {
        listRes = await client.query(
          `
            SELECT id, sort_order
            FROM nailoption
            WHERE shop_id = $1
              AND (show_from_date IS NULL OR show_from_date <= $2)
              AND (show_to_date IS NULL OR show_to_date >= $2)
            ORDER BY sort_order ASC, created_at ASC, option_name ASC
            FOR UPDATE
          `,
          [shopId, scopeDate]
        )
      } else {
        listRes = await client.query(
          `
            SELECT id, sort_order
            FROM nailoption
            WHERE shop_id = $1
            ORDER BY sort_order ASC, created_at ASC, option_name ASC
            FOR UPDATE
          `,
          [shopId]
        )
      }

      const list = listRes.rows
      const index = list.findIndex((row) => row.id === req.params.id)
      if (index === -1) {
        const err = new Error('ไม่พบรายการบริการในรายการที่จัดลำดับ')
        err.status = 404
        throw err
      }

      const swapIndex = direction === 'up' ? index - 1 : index + 1
      if (swapIndex < 0 || swapIndex >= list.length) return

      const current = list[index]
      const neighbor = list[swapIndex]

      await client.query(
        `UPDATE nailoption SET sort_order = $1, updated_at = NOW() WHERE id = $2 AND shop_id = $3`,
        [neighbor.sort_order, current.id, shopId]
      )
      await client.query(
        `UPDATE nailoption SET sort_order = $1, updated_at = NOW() WHERE id = $2 AND shop_id = $3`,
        [current.sort_order, neighbor.id, shopId]
      )
    })

    res.json({ success: true, message: 'จัดลำดับแล้ว' })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    res.status(500).json({ error: err.message })
  }
})

router.delete('/nailoptions/:id', async (req, res) => {
  try {
    const pool = getPool()
    const shopId = req.shop.id
    const optionId = req.params.id

    const activeUse = await pool.query(
      `
        SELECT 1
        FROM booking_nailoptions bn
        JOIN bookings b ON b.id = bn.booking_id
        WHERE bn.nailoption_id = $1
          AND b.shop_id = $2
          AND b.status IN ('awaiting_payment', 'pending')
        LIMIT 1
      `,
      [optionId, shopId]
    )

    if (activeUse.rows.length > 0) {
      return res.status(409).json({
        error:
          'บริการนี้ยังถูกใช้ในคิวที่รอชำระหรือรอให้บริการ ให้ปิดการใช้งาน (ไม่แสดง) แทนการลบ',
      })
    }

    await pool.query(`DELETE FROM booking_nailoptions WHERE nailoption_id = $1`, [optionId])

    const result = await pool.query(
      `DELETE FROM nailoption WHERE id = $1 AND shop_id = $2`,
      [optionId, shopId]
    )

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

// ─── Service locations (ปุ่มลัดเพิ่มสถานที่) ─────────────────

router.get('/service-locations', async (req, res) => {
  try {
    const pool = getPool()
    const shopId = req.shop.id
    const result = await pool.query(
      `
      SELECT id, name, color, description, sort_order, is_active, created_at, updated_at
      FROM service_locations
      WHERE shop_id = $1
      ORDER BY sort_order ASC, name ASC
    `,
      [shopId]
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/service-locations', async (req, res) => {
  const name = String(req.body?.name || '').trim()
  const description = String(req.body?.description || '').trim() || null
  const colorParsed = parseOptionalColor(req.body?.color || '#3b82f6')
  const sort_order = Number(req.body?.sort_order ?? 0)
  const is_active = req.body?.is_active !== false

  if (!name) return res.status(400).json({ error: 'กรุณาระบุชื่อสถานที่' })
  if (colorParsed?.error) return res.status(400).json({ error: colorParsed.error })

  try {
    const pool = getPool()
    const shopId = req.shop.id
    const result = await pool.query(
      `
        INSERT INTO service_locations (shop_id, name, color, description, sort_order, is_active)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, name, color, description, sort_order, is_active, created_at, updated_at
      `,
      [shopId, name, colorParsed, description || `สถานที่ให้บริการ ${name}`, sort_order, is_active]
    )
    res.status(201).json({ success: true, location: result.rows[0] })
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'ชื่อสถานที่ซ้ำ กรุณาใช้ชื่ออื่น' })
    }
    res.status(500).json({ error: err.message })
  }
})

router.patch('/service-locations/:id', async (req, res) => {
  const name = String(req.body?.name || '').trim()
  const description = String(req.body?.description || '').trim() || null
  const colorParsed = parseOptionalColor(req.body?.color)
  const sort_order = Number(req.body?.sort_order ?? 0)
  const is_active = Boolean(req.body?.is_active)

  if (!name) return res.status(400).json({ error: 'กรุณาระบุชื่อสถานที่' })
  if (colorParsed?.error) return res.status(400).json({ error: colorParsed.error })

  try {
    const pool = getPool()
    const shopId = req.shop.id
    const result = await pool.query(
      `
        UPDATE service_locations
        SET
          name = $1,
          color = $2,
          description = $3,
          sort_order = $4,
          is_active = $5,
          updated_at = NOW()
        WHERE id = $6 AND shop_id = $7
        RETURNING id, name, color, description, sort_order, is_active, created_at, updated_at
      `,
      [name, colorParsed, description || `สถานที่ให้บริการ ${name}`, sort_order, is_active, req.params.id, shopId]
    )
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'ไม่พบสถานที่' })
    }
    res.json({ success: true, location: result.rows[0] })
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'ชื่อสถานที่ซ้ำ กรุณาใช้ชื่ออื่น' })
    }
    res.status(500).json({ error: err.message })
  }
})

router.delete('/service-locations/:id', async (req, res) => {
  try {
    const pool = getPool()
    const shopId = req.shop.id
    const result = await pool.query(
      `DELETE FROM service_locations WHERE id = $1 AND shop_id = $2`,
      [req.params.id, shopId]
    )
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'ไม่พบสถานที่' })
    }
    res.json({ success: true, message: 'ลบสถานที่แล้ว' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/showcase-clips', async (req, res) => {
  try {
    const pool = getPool()
    const shopId = req.shop.id
    const result = await pool.query(
      `
        SELECT id, source, tiktok_url, video_id, title, thumbnail_url, sort_order, is_active, created_at, updated_at
        FROM showcase_clips
        WHERE shop_id = $1
        ORDER BY sort_order ASC, created_at DESC
      `,
      [shopId]
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/showcase-clips', async (req, res) => {
  const mediaUrl = String(req.body?.tiktok_url || req.body?.clip_url || '').trim()
  const title = String(req.body?.title || '').trim() || null
  const is_active = req.body?.is_active !== false

  if (!mediaUrl) {
    return res.status(400).json({ error: 'กรุณาวางลิงก์คลิป TikTok หรือ Instagram' })
  }

  try {
    const resolved = await resolveShowcaseClip(mediaUrl)
    if (!resolved) {
      return res.status(400).json({
        error: 'ลิงก์ไม่ถูกต้อง ใช้ลิงก์ TikTok (.../video/123) หรือ Instagram (.../p/... หรือ .../reel/...)',
      })
    }

    const pool = getPool()
    const shopId = req.shop.id
    const orderRes = await pool.query(
      `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM showcase_clips WHERE shop_id = $1`,
      [shopId]
    )
    const sort_order = Number(orderRes.rows[0]?.next_order) || 1

    const thumbnail_url = await fetchShowcaseThumbnail(resolved.source, resolved.tiktok_url)

    const result = await pool.query(
      `
        INSERT INTO showcase_clips (shop_id, source, tiktok_url, video_id, title, thumbnail_url, sort_order, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, source, tiktok_url, video_id, title, thumbnail_url, sort_order, is_active, created_at, updated_at
      `,
      [shopId, resolved.source, resolved.tiktok_url, resolved.video_id, title, thumbnail_url, sort_order, is_active]
    )

    res.status(201).json({ success: true, clip: result.rows[0] })
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'คลิปนี้มีในระบบแล้ว' })
    }
    res.status(500).json({ error: err.message })
  }
})

router.patch('/showcase-clips/:id', async (req, res) => {
  const has = (key) => Object.prototype.hasOwnProperty.call(req.body, key)
  if (!has('tiktok_url') && !has('clip_url') && !has('title') && !has('is_active') && !has('sort_order')) {
    return res.status(400).json({ error: 'ไม่มีข้อมูลให้แก้ไข' })
  }

  try {
    const pool = getPool()
    const shopId = req.shop.id
    const existing = await pool.query(
      `SELECT * FROM showcase_clips WHERE id = $1 AND shop_id = $2`,
      [req.params.id, shopId]
    )
    if (!existing.rows.length) {
      return res.status(404).json({ error: 'ไม่พบคลิป' })
    }

    let source = existing.rows[0].source || 'tiktok'
    let tiktok_url = existing.rows[0].tiktok_url
    let video_id = existing.rows[0].video_id
    let thumbnail_url = existing.rows[0].thumbnail_url

    if (has('tiktok_url') || has('clip_url')) {
      const inputUrl = String(req.body.tiktok_url || req.body.clip_url || '').trim()
      if (!inputUrl) {
        return res.status(400).json({ error: 'กรุณาวางลิงก์คลิป TikTok หรือ Instagram' })
      }
      const resolved = await resolveShowcaseClip(inputUrl)
      if (!resolved) {
        return res.status(400).json({ error: 'ลิงก์ TikTok หรือ Instagram ไม่ถูกต้อง' })
      }
      source = resolved.source
      tiktok_url = resolved.tiktok_url
      video_id = resolved.video_id
      thumbnail_url = await fetchShowcaseThumbnail(resolved.source, resolved.tiktok_url)
    }

    const title = has('title')
      ? (String(req.body.title || '').trim() || null)
      : existing.rows[0].title
    const is_active = has('is_active') ? Boolean(req.body.is_active) : existing.rows[0].is_active
    const sort_order = has('sort_order')
      ? Number(req.body.sort_order)
      : existing.rows[0].sort_order

    if (has('sort_order') && !Number.isFinite(sort_order)) {
      return res.status(400).json({ error: 'sort_order ไม่ถูกต้อง' })
    }

    const result = await pool.query(
      `
        UPDATE showcase_clips
        SET
          source = $1,
          tiktok_url = $2,
          video_id = $3,
          title = $4,
          thumbnail_url = $5,
          is_active = $6,
          sort_order = $7,
          updated_at = NOW()
        WHERE id = $8 AND shop_id = $9
        RETURNING id, source, tiktok_url, video_id, title, thumbnail_url, sort_order, is_active, created_at, updated_at
      `,
      [source, tiktok_url, video_id, title, thumbnail_url, is_active, sort_order, req.params.id, shopId]
    )

    res.json({ success: true, clip: result.rows[0] })
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'คลิปนี้มีในระบบแล้ว' })
    }
    res.status(500).json({ error: err.message })
  }
})

router.post('/showcase-clips/:id/refresh-thumbnail', async (req, res) => {
  try {
    const pool = getPool()
    const shopId = req.shop.id
    const existing = await pool.query(
      `SELECT id, source, tiktok_url FROM showcase_clips WHERE id = $1 AND shop_id = $2`,
      [req.params.id, shopId]
    )
    if (!existing.rows.length) {
      return res.status(404).json({ error: 'ไม่พบคลิป' })
    }

    const row = existing.rows[0]
    const thumbnail_url = await fetchShowcaseThumbnail(row.source || 'tiktok', row.tiktok_url)
    if (!thumbnail_url) {
      return res.status(502).json({ error: 'ดึงรูปปกไม่สำเร็จ ลองใหม่ภายหลัง' })
    }

    const result = await pool.query(
      `
        UPDATE showcase_clips
        SET thumbnail_url = $1, updated_at = NOW()
        WHERE id = $2 AND shop_id = $3
        RETURNING id, source, tiktok_url, video_id, title, thumbnail_url, sort_order, is_active, created_at, updated_at
      `,
      [thumbnail_url, req.params.id, shopId]
    )

    res.json({ success: true, message: 'ดึงรูปปกแล้ว', clip: result.rows[0] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/showcase-clips/:id', async (req, res) => {
  try {
    const pool = getPool()
    const shopId = req.shop.id
    const result = await pool.query(
      `DELETE FROM showcase_clips WHERE id = $1 AND shop_id = $2`,
      [req.params.id, shopId]
    )
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'ไม่พบคลิป' })
    }
    res.json({ success: true, message: 'ลบคลิปแล้ว' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.patch('/showcase-clips/:id/move', async (req, res) => {
  const direction = req.body?.direction === 'down' ? 'down' : 'up'

  try {
    const shopId = req.shop.id
    await withTransaction(async (client) => {
      const allRes = await client.query(
        `
          SELECT id, sort_order
          FROM showcase_clips
          WHERE shop_id = $1
          ORDER BY sort_order ASC, created_at ASC
          FOR UPDATE
        `,
        [shopId]
      )
      const list = allRes.rows
      const index = list.findIndex((row) => row.id === req.params.id)
      if (index === -1) {
        const err = new Error('ไม่พบคลิป')
        err.status = 404
        throw err
      }

      const swapIndex = direction === 'up' ? index - 1 : index + 1
      if (swapIndex < 0 || swapIndex >= list.length) return

      const current = list[index]
      const neighbor = list[swapIndex]

      await client.query(
        `UPDATE showcase_clips SET sort_order = $1, updated_at = NOW() WHERE id = $2 AND shop_id = $3`,
        [neighbor.sort_order, current.id, shopId]
      )
      await client.query(
        `UPDATE showcase_clips SET sort_order = $1, updated_at = NOW() WHERE id = $2 AND shop_id = $3`,
        [current.sort_order, neighbor.id, shopId]
      )
    })

    res.json({ success: true, message: 'จัดลำดับแล้ว' })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
