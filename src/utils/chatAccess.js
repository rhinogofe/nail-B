async function assertChatUserAccess(poolOrClient, shop, userId) {
  if (shop.slug === 'default') return true
  const result = await poolOrClient.query(
    `
      SELECT 1 FROM bookings WHERE shop_id = $1 AND user_id = $2
      UNION ALL
      SELECT 1 FROM chat_messages WHERE shop_id = $1 AND user_id = $2
      LIMIT 1
    `,
    [shop.id, userId]
  )
  return result.rows.length > 0
}

function normalizeChatBody(value) {
  const body = String(value || '').trim()
  if (!body) return ''
  if (body.length > 2000) return body.slice(0, 2000)
  return body
}

async function requireChatUserAccess(poolOrClient, shop, userId) {
  const ok = await assertChatUserAccess(poolOrClient, shop, userId)
  if (!ok) {
    const err = new Error('ไม่มีสิทธิ์แชทกับผู้ใช้นี้')
    err.status = 403
    throw err
  }
}

module.exports = {
  assertChatUserAccess,
  requireChatUserAccess,
  normalizeChatBody,
}
