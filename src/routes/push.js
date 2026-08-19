const router = require('express').Router()
const auth = require('../middleware/authMiddleware')
const resolveShop = require('../middleware/resolveShop')
const { getPool } = require('../db/pool')
const { isFcmConfigured } = require('../utils/fcmPush')
const { isSuperAdmin } = require('../utils/shopAdmins')
const {
  upsertFcmToken,
  disableFcmToken,
  disableAllFcmTokensForUser,
  getUserPushStatus,
  getTokenPushStatus,
} = require('../utils/fcmTokens')

async function getPushPreferences(pool, userId) {
  const superAdmin = await isSuperAdmin(pool, userId)
  if (!superAdmin) {
    return { is_super_admin: false, receive_all_shop_push: false }
  }
  const result = await pool.query(
    `SELECT receive_all_shop_push FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  )
  return {
    is_super_admin: true,
    receive_all_shop_push: Boolean(result.rows[0]?.receive_all_shop_push),
  }
}

router.use(resolveShop)
router.use(auth)

router.get('/status', async (req, res) => {
  try {
    const pool = getPool()
    const token = String(req.query.token || '').trim()
    const enabled = token
      ? await getTokenPushStatus(pool, req.user.id, token)
      : await getUserPushStatus(pool, req.user.id)
    const preferences = await getPushPreferences(pool, req.user.id)
    res.json({
      configured: isFcmConfigured(),
      enabled,
      ...preferences,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.patch('/preferences', async (req, res) => {
  try {
    const pool = getPool()
    const superAdmin = await isSuperAdmin(pool, req.user.id)
    if (!superAdmin) {
      return res.status(403).json({ error: 'เฉพาะแอดมินหลักเท่านั้น' })
    }
    if (!Object.prototype.hasOwnProperty.call(req.body, 'receive_all_shop_push')) {
      return res.status(400).json({ error: 'ต้องระบุ receive_all_shop_push' })
    }
    const receiveAll = Boolean(req.body.receive_all_shop_push)
    await pool.query(
      `UPDATE users SET receive_all_shop_push = $1 WHERE id = $2`,
      [receiveAll, req.user.id]
    )
    res.json({
      is_super_admin: true,
      receive_all_shop_push: receiveAll,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/token', async (req, res) => {
  const token = String(req.body?.token || '').trim()
  const enabled = req.body?.enabled !== false

  if (!token) {
    return res.status(400).json({ error: 'token จำเป็น' })
  }
  if (!isFcmConfigured()) {
    return res.status(503).json({ error: 'ระบบ push ยังไม่ได้ตั้งค่า' })
  }

  try {
    const pool = getPool()
    if (!enabled) {
      await disableFcmToken(pool, { userId: req.user.id, token })
      return res.json({ ok: true, enabled: false })
    }

    const row = await upsertFcmToken(pool, {
      userId: req.user.id,
      token,
      enabled: true,
      userAgent: String(req.headers['user-agent'] || '').slice(0, 500),
    })
    res.json({ ok: true, enabled: Boolean(row?.enabled) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/disable', async (req, res) => {
  try {
    const pool = getPool()
    const token = String(req.body?.token || '').trim()
    if (token) {
      await disableFcmToken(pool, { userId: req.user.id, token })
    } else {
      await disableAllFcmTokensForUser(pool, req.user.id)
    }
    res.json({ ok: true, enabled: false })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
