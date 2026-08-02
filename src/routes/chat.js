const router = require('express').Router()
const auth = require('../middleware/authMiddleware')
const resolveShop = require('../middleware/resolveShop')
const { getPool } = require('../db/pool')
const { canManageShop } = require('../utils/shopAdmins')
const { createChatMessage, MESSAGE_FIELDS } = require('../utils/chatMessages')
const { readChatImageFile, MIME_EXT } = require('../utils/chatImages')

router.use(resolveShop)
router.use(auth)

async function assertImageAccess(pool, shop, user, filename) {
  const msgRes = await pool.query(
    `
      SELECT user_id
      FROM chat_messages
      WHERE shop_id = $1 AND image_url = $2
      LIMIT 1
    `,
    [shop.id, filename]
  )
  if (!msgRes.rows[0]) return false
  if (msgRes.rows[0].user_id === user.id) return true
  if (user.is_admin && await canManageShop(pool, user.id, shop.id)) return true
  return false
}

router.get('/messages', async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.query(
      `
        SELECT ${MESSAGE_FIELDS}
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
  try {
    const pool = getPool()
    const row = await createChatMessage(pool, {
      shopId: req.shop.id,
      userId: req.user.id,
      senderRole: 'customer',
      senderId: req.user.id,
      body: req.body?.body,
      imageData: req.body?.image_data,
      imageMime: req.body?.image_mime,
    })
    res.status(201).json(row)
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    res.status(500).json({ error: err.message })
  }
})

router.get('/images/:filename', async (req, res) => {
  try {
    const pool = getPool()
    const filename = req.params.filename
    const allowed = await assertImageAccess(pool, req.shop, req.user, filename)
    if (!allowed) return res.status(404).json({ error: 'ไม่พบรูป' })

    const buffer = await readChatImageFile(req.shop.id, filename)
    if (!buffer) return res.status(404).json({ error: 'ไม่พบรูป' })

    const ext = filename.split('.').pop()?.toLowerCase()
    const mime = Object.entries(MIME_EXT).find(([, value]) => value === ext)?.[0] || 'image/jpeg'
    res.set('Content-Type', mime)
    res.set('Cache-Control', 'private, max-age=3600')
    res.send(buffer)
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
