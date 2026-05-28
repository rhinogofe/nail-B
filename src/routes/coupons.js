const crypto = require('crypto')
const router = require('express').Router()
const auth = require('../middleware/authMiddleware')
const { sql, getPool } = require('../db/pool')

const REQUIRED_POINTS = 100
const DISCOUNT_PERCENT = 20

function generateCouponCode(length = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.randomBytes(length)
  let code = ''
  for (let i = 0; i < length; i += 1) {
    code += chars[bytes[i] % chars.length]
  }
  return code
}

async function generateUniqueCode(pool) {
  for (let i = 0; i < 10; i += 1) {
    const code = generateCouponCode(10)
    const found = await pool.request()
      .input('code', sql.NVarChar, code)
      .query(`SELECT TOP 1 id FROM coupons WHERE coupon_code = @code`)
    if (!found.recordset[0]) return code
  }
  throw new Error('ไม่สามารถสร้างคูปองได้ กรุณาลองใหม่')
}

router.get('/my', auth, async (req, res) => {
  try {
    const pool = await getPool()
    const result = await pool.request()
      .input('userId', sql.UniqueIdentifier, req.user.id)
      .query(`
        SELECT id, coupon_code, discount_percent, required_points, is_used, used_at, created_at
        FROM coupons
        WHERE user_id = @userId
        ORDER BY created_at DESC
      `)
    res.json(result.recordset)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/redeem', auth, async (req, res) => {
  const pool = await getPool()
  const transaction = new (require('mssql').Transaction)(pool)

  try {
    await transaction.begin()

    const req1 = new (require('mssql').Request)(transaction)
    req1.input('userId', sql.UniqueIdentifier, req.user.id)
    const foundUser = await req1.query(`
      SELECT id, total_points
      FROM users WITH (UPDLOCK, ROWLOCK)
      WHERE id = @userId
    `)

    const user = foundUser.recordset[0]
    if (!user) {
      await transaction.rollback()
      return res.status(404).json({ error: 'ไม่พบผู้ใช้' })
    }

    if (Number(user.total_points) < REQUIRED_POINTS) {
      await transaction.rollback()
      return res.status(400).json({ error: 'แต้มไม่พอสำหรับแลกคูปอง' })
    }

    const code = await generateUniqueCode(pool)

    const req2 = new (require('mssql').Request)(transaction)
    req2.input('userId', sql.UniqueIdentifier, req.user.id)
    req2.input('cost', sql.Int, REQUIRED_POINTS)
    await req2.query(`
      UPDATE users
      SET total_points = total_points - @cost
      WHERE id = @userId
    `)

    const req3 = new (require('mssql').Request)(transaction)
    req3.input('userId', sql.UniqueIdentifier, req.user.id)
    req3.input('code', sql.NVarChar, code)
    req3.input('discount', sql.Int, DISCOUNT_PERCENT)
    req3.input('requiredPoints', sql.Int, REQUIRED_POINTS)
    const created = await req3.query(`
      INSERT INTO coupons (user_id, coupon_code, discount_percent, required_points)
      OUTPUT INSERTED.id, INSERTED.coupon_code, INSERTED.discount_percent, INSERTED.required_points, INSERTED.created_at
      VALUES (@userId, @code, @discount, @requiredPoints)
    `)

    await transaction.commit()
    res.status(201).json({ success: true, coupon: created.recordset[0] })
  } catch (err) {
    await transaction.rollback().catch(() => {})
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
