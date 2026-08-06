const { loadBookingNotifyContext, applyTemplate } = require('./bookingLineNotify')
const { getChatNotifySettings } = require('./chatNotifySettings')
const { createChatMessage } = require('./chatMessages')
const { ensureSystemChatUser } = require('./systemChatUser')

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

async function insertSystemChatMessage(poolOrClient, { shopId, relatedUserId, body }) {
  const text = String(body || '').trim()
  if (!text) return null
  const systemUserId = await ensureSystemChatUser(poolOrClient, shopId)
  return createChatMessage(poolOrClient, {
    shopId,
    userId: systemUserId,
    senderRole: 'system',
    senderId: systemUserId,
    relatedUserId,
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
      relatedUserId: customerUserId,
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
      relatedUserId: customerUserId,
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

async function getBookingCustomerUserId(poolOrClient, shopId, bookingId) {
  const userRes = await poolOrClient.query(
    `SELECT user_id FROM bookings WHERE id = $1 AND shop_id = $2`,
    [bookingId, shopId]
  )
  return userRes.rows[0]?.user_id || null
}

async function notifyBookingCancelledChat(poolOrClient, shopId, bookingId) {
  try {
    const settings = await getChatNotifySettings(poolOrClient, shopId)
    if (!settings.cancelAdminEnabled && !settings.cancelCustomerEnabled) {
      return { ok: false, skipped: true, reason: 'disabled' }
    }

    const ctx = await loadBookingNotifyContext(poolOrClient, shopId, bookingId)
    if (!ctx) return { ok: false, skipped: true, reason: 'booking_not_found' }

    const customerUserId = await getBookingCustomerUserId(poolOrClient, shopId, bookingId)
    if (!customerUserId) return { ok: false, skipped: true, reason: 'no_customer' }

    const results = {}
    if (settings.cancelAdminEnabled) {
      const text = applyTemplate(settings.cancelAdminTemplate, ctx)
      const row = await insertSystemChatMessage(poolOrClient, {
        shopId,
        relatedUserId: customerUserId,
        body: text,
      })
      results.admin = row ? { ok: true, messageId: row.id } : { ok: false, skipped: true }
    }
    if (settings.cancelCustomerEnabled) {
      const text = applyTemplate(settings.cancelCustomerTemplate, ctx)
      const row = await insertAdminChatMessage(poolOrClient, {
        shopId,
        userId: customerUserId,
        body: text,
      })
      results.customer = row ? { ok: true, messageId: row.id } : { ok: false, skipped: true }
    }
    return { ok: true, results }
  } catch (err) {
    console.error('notifyBookingCancelledChat:', err.message)
    return { ok: false, error: err.message }
  }
}

async function notifyBookingPaidChat(poolOrClient, shopId, bookingId) {
  try {
    const settings = await getChatNotifySettings(poolOrClient, shopId)
    if (!settings.paidAdminEnabled && !settings.paidCustomerEnabled) {
      return { ok: false, skipped: true, reason: 'disabled' }
    }

    const ctx = await loadBookingNotifyContext(poolOrClient, shopId, bookingId)
    if (!ctx) return { ok: false, skipped: true, reason: 'booking_not_found' }

    const customerUserId = await getBookingCustomerUserId(poolOrClient, shopId, bookingId)
    if (!customerUserId) return { ok: false, skipped: true, reason: 'no_customer' }

    const results = {}
    if (settings.paidAdminEnabled) {
      const text = applyTemplate(settings.paidAdminTemplate, ctx)
      const row = await insertSystemChatMessage(poolOrClient, {
        shopId,
        relatedUserId: customerUserId,
        body: text,
      })
      results.admin = row ? { ok: true, messageId: row.id } : { ok: false, skipped: true }
    }
    if (settings.paidCustomerEnabled) {
      const text = applyTemplate(settings.paidCustomerTemplate, ctx)
      const row = await insertAdminChatMessage(poolOrClient, {
        shopId,
        userId: customerUserId,
        body: text,
      })
      results.customer = row ? { ok: true, messageId: row.id } : { ok: false, skipped: true }
    }
    return { ok: true, results }
  } catch (err) {
    console.error('notifyBookingPaidChat:', err.message)
    return { ok: false, error: err.message }
  }
}

module.exports = {
  notifyAdminNewBookingChat,
  notifyAdminUpcomingChat,
  notifyCustomerUpcomingChat,
  notifyBookingCancelledChat,
  notifyBookingPaidChat,
}
