const crypto = require('crypto')
const router = require('express').Router()
const auth = require('../middleware/authMiddleware')
const { getPool, withTransaction } = require('../db/pool')

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

async function generateUniqueCode(client) {
  for (let i = 0; i < 10; i += 1) {
    const code = generateCouponCode(10)
    const found = await client.query(
      `SELECT id FROM coupons WHERE coupon_code = $1 LIMIT 1`,
      [code]
    )
    if (!found.rows[0]) return code
  }
  throw new Error('ไม่สามารถสร้างคูปองได้ กรุณาลองใหม่')
}

router.get('/my', auth, async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.query(
      `
        SELECT id, coupon_code, discount_percent, required_points, is_used, used_at, created_at
        FROM coupons
        WHERE user_id = $1
        ORDER BY created_at DESC
      `,
      [req.user.id]
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/redeem', auth, async (req, res) => {
  try {
    const coupon = await withTransaction(async (client) => {
      const foundUser = await client.query(
        `SELECT id, total_points FROM users WHERE id = $1 FOR UPDATE`,
        [req.user.id]
      )

      const user = foundUser.rows[0]
      if (!user) {
        const err = new Error('ไม่พบผู้ใช้')
        err.status = 404
        throw err
      }

      if (Number(user.total_points) < REQUIRED_POINTS) {
        const err = new Error('แต้มไม่พอสำหรับแลกคูปอง')
        err.status = 400
        throw err
      }

      const code = await generateUniqueCode(client)

      await client.query(
        `UPDATE users SET total_points = total_points - $1 WHERE id = $2`,
        [REQUIRED_POINTS, req.user.id]
      )

      const created = await client.query(
        `
          INSERT INTO coupons (user_id, coupon_code, discount_percent, required_points)
          VALUES ($1, $2, $3, $4)
          RETURNING id, coupon_code, discount_percent, required_points, created_at
        `,
        [req.user.id, code, DISCOUNT_PERCENT, REQUIRED_POINTS]
      )

      return created.rows[0]
    })

    res.status(201).json({ success: true, coupon })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
