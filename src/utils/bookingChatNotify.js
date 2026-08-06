const { loadBookingNotifyContext, applyTemplate } = require('./bookingLineNotify')
const { getChatNotifySettings } = require('./chatNotifySettings')
const { createChatMessage } = require('./chatMessages')

async function getShopAdminSenderId(poolOrClient, shopId) {
  const shopAdmin = await poolOrClient.query(
    `
      SELECT sa.user_id
      FROM shop_admins sa
      WHERE sa.shop_id = $1
      LIMIT 1
    `,
    [shopId]
  )
  if (shopAdmin.rows[0]?.user_id) return shopAdmin.rows[0].user_id

  const fallback = await poolOrClient.query(
    `
      SELECT u.id
      FROM users u
      WHERE u.is_admin = true
      ORDER BY u.created_at ASC
      LIMIT 1
    `
  )
  return fallback.rows[0]?.id || null
}

async function insertSystemChatMessage(poolOrClient, { shopId, userId, body }) {
  const text = String(body || '').trim()
  if (!text) return null
  return createChatMessage(poolOrClient, {
    shopId,
    userId,
    senderRole: 'system',
    senderId: userId,
    body: text,
  })
}

async function insertAdminChatMessage(poolOrClient, { shopId, userId, body, senderId }) {
  const text = String(body || '').trim()
  if (!text) return null
  const adminId = senderId || await getShopAdminSenderId(poolOrClient, shopId)
  if (!adminId) return null
  return createChatMessage(poolOrClient, {
    shopId,
    userId,
    senderRole: 'admin',
    senderId: adminId,
    body: text,
  })
}

async function notifyAdminNewBookingChat(poolOrClient, shopId, bookingId) {
  try {
    const settings = await getChatNotifySettings(poolOrClient, shopId)
    if (!settings.newBookingEnabled) {
      return { ok: false, skipped: true, reason: 'disabled' }
    }

    const ctx = await loadBookingNotifyContext(poolOrClient, shopId, bookingId)
    if (!ctx) return { ok: false, skipped: true, reason: 'booking_not_found' }

    const userRes = await poolOrClient.query(
      `SELECT user_id FROM bookings WHERE id = $1 AND shop_id = $2`,
      [bookingId, shopId]
    )
    const customerUserId = userRes.rows[0]?.user_id
    if (!customerUserId) return { ok: false, skipped: true, reason: 'no_customer' }

    const text = applyTemplate(settings.newBookingTemplate, ctx)
    const row = await insertSystemChatMessage(poolOrClient, {
      shopId,
      userId: customerUserId,
      body: text,
    })
    if (!row) return { ok: false, skipped: true, reason: 'empty_message' }
    return { ok: true, messageId: row.id }
  } catch (err) {
    console.error('notifyAdminNewBookingChat:', err.message)
    return { ok: false, error: err.message }
  }
}

async function notifyAdminUpcomingChat(poolOrClient, shopId, bookingId, minutesUntil) {
  try {
    const settings = await getChatNotifySettings(poolOrClient, shopId)
    if (!settings.upcomingAdminEnabled) {
      return { ok: false, skipped: true, reason: 'disabled' }
    }

    const ctx = await loadBookingNotifyContext(poolOrClient, shopId, bookingId)
    if (!ctx) return { ok: false, skipped: true, reason: 'booking_not_found' }

    const userRes = await poolOrClient.query(
      `SELECT user_id FROM bookings WHERE id = $1 AND shop_id = $2`,
      [bookingId, shopId]
    )
    const customerUserId = userRes.rows[0]?.user_id
    if (!customerUserId) return { ok: false, skipped: true, reason: 'no_customer' }

    const text = applyTemplate(settings.upcomingAdminTemplate, {
      ...ctx,
      minutesUntil: String(minutesUntil),
    })
    const row = await insertSystemChatMessage(poolOrClient, {
      shopId,
      userId: customerUserId,
      body: text,
    })
    if (!row) return { ok: false, skipped: true, reason: 'empty_message' }
    return { ok: true, messageId: row.id }
  } catch (err) {
    console.error('notifyAdminUpcomingChat:', err.message)
    return { ok: false, error: err.message }
  }
}

async function notifyCustomerUpcomingChat(poolOrClient, shopId, bookingId, minutesUntil) {
  try {
    const settings = await getChatNotifySettings(poolOrClient, shopId)
    if (!settings.upcomingCustomerEnabled) {
      return { ok: false, skipped: true, reason: 'disabled' }
    }

    const ctx = await loadBookingNotifyContext(poolOrClient, shopId, bookingId)
    if (!ctx) return { ok: false, skipped: true, reason: 'booking_not_found' }

    const userRes = await poolOrClient.query(
      `SELECT user_id FROM bookings WHERE id = $1 AND shop_id = $2`,
      [bookingId, shopId]
    )
    const customerUserId = userRes.rows[0]?.user_id
    if (!customerUserId) return { ok: false, skipped: true, reason: 'no_customer' }

    const text = applyTemplate(settings.upcomingCustomerTemplate, {
      ...ctx,
      minutesUntil: String(minutesUntil),
    })
    const row = await insertAdminChatMessage(poolOrClient, {
      shopId,
      userId: customerUserId,
      body: text,
    })
    if (!row) return { ok: false, skipped: true, reason: 'empty_message' }
    return { ok: true, messageId: row.id }
  } catch (err) {
    console.error('notifyCustomerUpcomingChat:', err.message)
    return { ok: false, error: err.message }
  }
}

module.exports = {
  notifyAdminNewBookingChat,
  notifyAdminUpcomingChat,
  notifyCustomerUpcomingChat,
}
