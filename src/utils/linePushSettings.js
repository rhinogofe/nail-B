const { getShopSettings, setShopSettings } = require('./shopSettings')
const { isCentralLineBotEnabled, getCentralLineBotCredentials } = require('./lineBotMode')

const SETTING_KEYS = [
  'line_push_enabled',
  'line_use_own_bot',
  'line_channel_access_token',
  'line_channel_secret',
  'line_push_to_id',
  'line_booking_notify_template',
]

const DEFAULT_TEMPLATE = `🔔 มีคิวจองใหม่ ({shop})
👤 {customer}
📅 {date} · {start}–{end}
💅 {services}
📋 สถานะ: {status}
🆔 {bookingId}`

function maskToken(token) {
  if (!token) return ''
  const s = String(token)
  if (s.length <= 8) return '••••••••'
  return `••••${s.slice(-4)}`
}

/** ร้านใช้บอทตัวเองเมื่อบอทกลางปิด หรือเปิด override (Premium) */
function shopUsesOwnBot(map = {}) {
  if (!isCentralLineBotEnabled()) return true
  return map.line_use_own_bot === 'true'
}

function resolveChannelAccessToken(shopToken, useOwnBot) {
  const shop = String(shopToken || '').trim()
  if (useOwnBot) return shop
  if (isCentralLineBotEnabled()) {
    return getCentralLineBotCredentials().channelAccessToken
  }
  return shop
}

function resolveChannelSecret(shopSecret, useOwnBot) {
  const shop = String(shopSecret || '').trim()
  if (useOwnBot) return shop
  if (isCentralLineBotEnabled()) {
    return getCentralLineBotCredentials().channelSecret
  }
  return shop
}

function getLineWebhookPath(slug, useOwnBot) {
  const normalized = String(slug || '').trim().toLowerCase()
  if (useOwnBot && normalized) return `/api/line/webhook/${normalized}`
  return '/api/line/webhook'
}

/** Channel secret ≈ 32 hex chars; access token is much longer */
function validateLineAccessToken(token) {
  const t = String(token || '').trim()
  if (!t) return { ok: false, reason: 'missing' }
  if (/^[a-f0-9]{32}$/i.test(t)) {
    return { ok: false, reason: 'looks_like_channel_secret' }
  }
  if (t.length < 80) {
    return { ok: false, reason: 'too_short' }
  }
  return { ok: true }
}

function logLineBotTokenStatus() {
  if (isCentralLineBotEnabled()) {
    const { channelAccessToken } = getCentralLineBotCredentials()
    const check = validateLineAccessToken(channelAccessToken)
    if (!check.ok) {
      console.warn(`⚠️ LINE บอทกลาง: token ไม่ถูกต้อง (${check.reason})`)
      return
    }
    console.log(`✅ LINE บอทกลางพร้อม (${maskToken(channelAccessToken)}) — ร้านทั่วไปใช้กลาง · Premium เปิด use_own_bot ในแอดมิน`)
    return
  }
  console.log('ℹ️ LINE บอทกลางปิด — ทุกสาขาตั้ง Channel Access Token + Channel Secret เอง')
}

async function getLinePushSettings(poolOrClient, shopId, { includeToken = false, includeSecret = false, shopSlug = null } = {}) {
  const map = await getShopSettings(poolOrClient, shopId, SETTING_KEYS)
  const shopToken = map.line_channel_access_token || ''
  const shopSecret = map.line_channel_secret || ''
  const useOwnBot = shopUsesOwnBot(map)
  const central = isCentralLineBotEnabled()
  const token = resolveChannelAccessToken(shopToken, useOwnBot)
  const secret = resolveChannelSecret(shopSecret, useOwnBot)
  return {
    central_bot_enabled: central,
    use_own_bot: useOwnBot,
    uses_own_bot: useOwnBot,
    enabled: map.line_push_enabled !== 'false' && Boolean(token && map.line_push_to_id),
    pushEnabledFlag: map.line_push_enabled !== 'false',
    channelAccessToken: includeToken ? token : undefined,
    channelSecret: includeSecret ? secret : undefined,
    tokenMasked: maskToken(token),
    secretMasked: maskToken(useOwnBot ? shopSecret : secret),
    tokenConfigured: Boolean(token),
    secretConfigured: useOwnBot ? Boolean(shopSecret) : Boolean(secret),
    tokenFromEnv: central && !useOwnBot,
    pushToId: map.line_push_to_id || '',
    notifyTemplate: map.line_booking_notify_template || DEFAULT_TEMPLATE,
    webhookPath: getLineWebhookPath(shopSlug, useOwnBot),
  }
}

async function setLinePushSettings(poolOrClient, shopId, partial) {
  const entries = {}
  if (typeof partial.enabled === 'boolean') {
    entries.line_push_enabled = partial.enabled ? 'true' : 'false'
  }
  if (typeof partial.useOwnBot === 'boolean') {
    entries.line_use_own_bot = partial.useOwnBot ? 'true' : 'false'
  }
  if (partial.pushToId != null) {
    entries.line_push_to_id = String(partial.pushToId).trim()
  }
  if (partial.notifyTemplate != null) {
    entries.line_booking_notify_template = String(partial.notifyTemplate)
  }

  let allowCredentials = !isCentralLineBotEnabled()
  if (partial.useOwnBot === false) {
    allowCredentials = false
  } else if (!allowCredentials && partial.useOwnBot === true) {
    allowCredentials = true
  } else if (!allowCredentials && partial.useOwnBot == null) {
    const current = await getShopSettings(poolOrClient, shopId, ['line_use_own_bot'])
    allowCredentials = current.line_use_own_bot === 'true'
  }

  if (allowCredentials) {
    if (partial.channelAccessToken != null) {
      const token = String(partial.channelAccessToken).trim()
      if (token) entries.line_channel_access_token = token
    }
    if (partial.channelSecret != null) {
      const secret = String(partial.channelSecret).trim()
      if (secret) entries.line_channel_secret = secret
    }
  }

  if (Object.keys(entries).length) {
    await setShopSettings(poolOrClient, shopId, entries)
  }
  return getLinePushSettings(poolOrClient, shopId)
}

function summarizeLinePushSettings(map = {}) {
  const shopToken = map.line_channel_access_token || ''
  const shopSecret = map.line_channel_secret || ''
  const useOwnBot = shopUsesOwnBot(map)
  const token = resolveChannelAccessToken(shopToken, useOwnBot)
  const secret = resolveChannelSecret(shopSecret, useOwnBot)
  const pushEnabledFlag = map.line_push_enabled !== 'false'
  const pushToId = String(map.line_push_to_id || '').trim()
  const credentialsReady = useOwnBot ? Boolean(token && secret) : Boolean(token)
  const configured = Boolean(credentialsReady && pushToId)
  return {
    line_push_enabled: pushEnabledFlag,
    line_push_configured: configured,
    line_push_ready: pushEnabledFlag && configured,
    line_use_own_bot: isCentralLineBotEnabled() && map.line_use_own_bot === 'true',
  }
}

async function enrichShopsWithLinePush(poolOrClient, shops) {
  if (!shops?.length) return shops || []
  const ids = shops.map((shop) => shop.id)
  const result = await poolOrClient.query(
    `SELECT shop_id, setting_key, setting_value
     FROM shop_settings
     WHERE shop_id = ANY($1::uuid[])
       AND setting_key IN (
         'line_push_enabled',
         'line_use_own_bot',
         'line_push_to_id',
         'line_channel_access_token',
         'line_channel_secret'
       )`,
    [ids]
  )
  const byShop = new Map()
  for (const row of result.rows) {
    if (!byShop.has(row.shop_id)) byShop.set(row.shop_id, {})
    byShop.get(row.shop_id)[row.setting_key] = row.setting_value
  }
  return shops.map((shop) => ({
    ...shop,
    ...summarizeLinePushSettings(byShop.get(shop.id) || {}),
  }))
}

module.exports = {
  DEFAULT_TEMPLATE,
  getLinePushSettings,
  setLinePushSettings,
  enrichShopsWithLinePush,
  summarizeLinePushSettings,
  shopUsesOwnBot,
  resolveChannelAccessToken,
  resolveChannelSecret,
  getLineWebhookPath,
  validateLineAccessToken,
  logLineBotTokenStatus,
}
