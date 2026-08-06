const { getShopSetting, setShopSetting } = require('./shopSettings')

const SYSTEM_USER_NAME = 'ระบบ'
const SYSTEM_USER_EMAIL = 'system@internal'

async function getSystemChatUserId(poolOrClient, shopId) {
  const stored = await getShopSetting(poolOrClient, shopId, 'system_chat_user_id')
  if (!stored) return null
  const check = await poolOrClient.query(`SELECT id FROM users WHERE id = $1`, [stored])
  return check.rows[0]?.id || null
}

async function ensureSystemChatUser(poolOrClient, shopId) {
  const existing = await getSystemChatUserId(poolOrClient, shopId)
  if (existing) return existing

  const providerId = `shop:${shopId}`
  const existingUser = await poolOrClient.query(
    `SELECT id FROM users WHERE provider = 'system' AND provider_id = $1 LIMIT 1`,
    [providerId]
  )
  if (existingUser.rows[0]?.id) {
    await setShopSetting(poolOrClient, shopId, 'system_chat_user_id', existingUser.rows[0].id)
    return existingUser.rows[0].id
  }

  const inserted = await poolOrClient.query(
    `
      INSERT INTO users (name, email, provider, provider_id, is_admin)
      VALUES ($1, $2, 'system', $3, false)
      RETURNING id
    `,
    [SYSTEM_USER_NAME, SYSTEM_USER_EMAIL, providerId]
  )
  const userId = inserted.rows[0]?.id
  if (!userId) throw new Error('Failed to create system chat user')

  await setShopSetting(poolOrClient, shopId, 'system_chat_user_id', userId)
  return userId
}

async function isSystemChatUser(poolOrClient, shopId, userId) {
  const systemId = await getSystemChatUserId(poolOrClient, shopId)
  return Boolean(systemId && systemId === userId)
}

module.exports = {
  SYSTEM_USER_NAME,
  SYSTEM_USER_EMAIL,
  getSystemChatUserId,
  ensureSystemChatUser,
  isSystemChatUser,
}
