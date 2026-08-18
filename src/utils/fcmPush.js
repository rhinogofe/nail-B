const { getMessaging, isFcmConfigured } = require('./firebaseAdmin')
const {
  deleteFcmToken,
  getEnabledTokensForShopAdmins,
  getEnabledTokensForUser,
} = require('./fcmTokens')

const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
])

function truncateBody(text, max = 180) {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

function getFrontendOrigin() {
  const origins = String(process.env.FRONTEND_URL || '')
    .split(',')
    .map((value) => value.trim().replace(/\/$/, ''))
    .filter(Boolean)
  const production = origins.find(
    (url) => /^https:\/\//i.test(url) && !/localhost|127\.0\.0\.1/i.test(url)
  )
  return production || origins[0] || ''
}

function toAbsoluteUrl(path) {
  const value = String(path || '/')
  if (/^https?:\/\//i.test(value)) return value
  const origin = getFrontendOrigin()
  if (!origin) return value
  return `${origin}${value.startsWith('/') ? value : `/${value}`}`
}

function buildNotificationPayload({ title, body, url, data = {} }) {
  const safeTitle = String(title || 'แจ้งเตือน').trim() || 'แจ้งเตือน'
  const safeBody = truncateBody(body)
  const absoluteUrl = toAbsoluteUrl(url)
  const payloadData = {
    ...data,
    title: safeTitle,
    body: safeBody,
    url: absoluteUrl,
  }
  const messageId = payloadData.messageId || payloadData.message_id || ''
  const origin = getFrontendOrigin()
  const iconUrl = origin ? `${origin}/favicon.svg` : '/favicon.svg'
  return {
    notification: {
      title: safeTitle,
      body: safeBody,
    },
    data: Object.fromEntries(
      Object.entries(payloadData).map(([key, value]) => [key, String(value ?? '')])
    ),
    webpush: {
      headers: {
        Urgency: 'high',
        TTL: '86400',
      },
      notification: {
        title: safeTitle,
        body: safeBody,
        icon: iconUrl,
        tag: messageId ? `nail-msg-${messageId}` : undefined,
      },
      fcmOptions: {
        link: absoluteUrl,
      },
    },
  }
}

async function removeInvalidTokens(pool, tokens, responses) {
  if (!responses?.length) return
  await Promise.all(
    responses.map(async (response, index) => {
      if (response.success) return
      const code = response.error?.code
      if (INVALID_TOKEN_CODES.has(code)) {
        await deleteFcmToken(pool, tokens[index]).catch(() => null)
      }
    })
  )
}

async function sendPushToTokens(pool, tokens, payload) {
  const uniqueTokens = [...new Set((tokens || []).filter(Boolean))]
  if (!uniqueTokens.length) return { ok: true, sent: 0, skipped: true, reason: 'no_tokens' }
  if (!isFcmConfigured()) return { ok: false, skipped: true, reason: 'fcm_not_configured' }

  const messaging = getMessaging()
  if (!messaging) return { ok: false, skipped: true, reason: 'fcm_not_configured' }

  const message = buildNotificationPayload(payload)
  try {
    const response = await messaging.sendEachForMulticast({
      tokens: uniqueTokens,
      ...message,
    })
    await removeInvalidTokens(pool, uniqueTokens, response.responses)
    if (process.env.NODE_ENV !== 'production') {
      console.log('FCM push:', {
        tokens: uniqueTokens.length,
        sent: response.successCount,
        failed: response.failureCount,
      })
    }
    return {
      ok: true,
      sent: response.successCount,
      failed: response.failureCount,
    }
  } catch (err) {
    console.error('sendPushToTokens:', err.message)
    return { ok: false, error: err.message }
  }
}

async function sendPushToUser(pool, userId, payload) {
  const tokens = await getEnabledTokensForUser(pool, userId)
  return sendPushToTokens(pool, tokens, payload)
}

async function sendPushToShopAdmins(pool, shopId, payload) {
  const tokens = await getEnabledTokensForShopAdmins(pool, shopId)
  return sendPushToTokens(pool, tokens, payload)
}

async function getShopPushContext(pool, shopId) {
  const result = await pool.query(
    `SELECT slug, name FROM shops WHERE id = $1 LIMIT 1`,
    [shopId]
  )
  return result.rows[0] || null
}

function buildChatPushPayload({ shopSlug, title, body, userId, target = 'admin' }) {
  const base = String(shopSlug || 'default')
  const url = target === 'customer'
    ? `/${base}/chat`
    : userId
      ? `/${base}/chat?userId=${userId}`
      : `/${base}/chat`
  return {
    title,
    body,
    url,
    data: {
      type: 'chat',
      shopSlug: base,
      userId: userId ? String(userId) : '',
      target,
    },
  }
}

async function pushAfterSystemChatNotify(pool, shopId, { body, relatedUserId, title = 'แจ้งเตือนระบบ', messageId = null }) {
  const shop = await getShopPushContext(pool, shopId)
  if (!shop) return { ok: false, skipped: true, reason: 'shop_not_found' }

  const { getSystemChatUserId } = require('./systemChatUser')
  const systemUserId = await getSystemChatUserId(pool, shopId)
  const payload = buildChatPushPayload({
    shopSlug: shop.slug,
    title: `${title} · ${shop.name}`,
    body,
    userId: systemUserId,
    target: 'admin',
  })
  if (messageId) {
    payload.data.messageId = String(messageId)
  }
  return sendPushToShopAdmins(pool, shopId, payload)
}

async function pushAfterCustomerChatNotify(pool, shopId, userId, { body, title = 'แจ้งเตือนจากร้าน', messageId = null }) {
  const shop = await getShopPushContext(pool, shopId)
  if (!shop || !userId) return { ok: false, skipped: true, reason: 'missing_target' }

  const payload = buildChatPushPayload({
    shopSlug: shop.slug,
    title: `${title} · ${shop.name}`,
    body,
    target: 'customer',
  })
  if (messageId) {
    payload.data.messageId = String(messageId)
  }
  return sendPushToUser(pool, userId, payload)
}

module.exports = {
  isFcmConfigured,
  sendPushToTokens,
  sendPushToUser,
  sendPushToShopAdmins,
  pushAfterSystemChatNotify,
  pushAfterCustomerChatNotify,
  buildChatPushPayload,
}
