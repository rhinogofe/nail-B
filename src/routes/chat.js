const router = require('express').Router()
const auth = require('../middleware/authMiddleware')
const resolveShop = require('../middleware/resolveShop')
const { getPool } = require('../db/pool')
const { normalizeChatBody } = require('../utils/chatAccess')

router.use(resolveShop)
router.use(auth)

router.get('/messages', async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.query(
      `
        SELECT
          id,
          body,
          sender_role,
          sender_id,
          read_at,
          created_at
        FROM chat_messages
        WHERE shop_id = $1 AND user_id = $2
        ORDER BY created_at ASC
        LIMIT 500
      `,
      [req.shop.id, req.user.id]
    )
    await pool.query(
      `
        UPDATE chat_messages
        SET read_at = NOW()
        WHERE shop_id = $1 AND user_id = $2 AND sender_role = 'admin' AND read_at IS NULL
      `,
      [req.shop.id, req.user.id]
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/messages', async (req, res) => {
  const body = normalizeChatBody(req.body?.body)
  if (!body) return res.status(400).json({ error: 'กรุณาพิมพ์ข้อความ' })

  try {
    const pool = getPool()
    const result = await pool.query(
      `
        INSERT INTO chat_messages (shop_id, user_id, sender_role, sender_id, body)
        VALUES ($1, $2, 'customer', $3, $4)
        RETURNING id, body, sender_role, sender_id, read_at, created_at
      `,
      [req.shop.id, req.user.id, req.user.id, body]
    )
    res.status(201).json(result.rows[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/unread-count', async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.query(
      `
        SELECT COUNT(*)::int AS count
        FROM chat_messages
        WHERE shop_id = $1 AND user_id = $2 AND sender_role = 'admin' AND read_at IS NULL
      `,
      [req.shop.id, req.user.id]
    )
    res.json({ count: result.rows[0]?.count || 0 })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
