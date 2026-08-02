const { getShopSettings, setShopSettings } = require('./shopSettings')

const SETTING_KEYS = [
  'line_push_enabled',
  'line_channel_access_token',
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

function resolveChannelAccessToken(shopToken) {
  const envToken = String(process.env.LINE_BOT_CHANNEL_ACCESS_TOKEN || '').trim()
  if (envToken) return envToken
  return String(shopToken || '').trim()
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
  const token = process.env.LINE_BOT_CHANNEL_ACCESS_TOKEN
  const check = validateLineAccessToken(token)
  if (!check.ok) {
    const hints = {
      missing: 'ยังไม่ได้ตั้ง — เพิ่ม LINE_BOT_CHANNEL_ACCESS_TOKEN บน Render',
      looks_like_channel_secret: 'ใส่ Channel secret แทน Access Token — ไป Issue ใหม่ที่ Messaging API',
      too_short: 'Token สั้นเกินไป — ต้องเป็น Channel access token จากปุ่ม Issue',
    }
    console.warn(`⚠️ LINE push: ${hints[check.reason] || check.reason}`)
    return
  }
  console.log(`✅ LINE bot token OK (${maskToken(token)})`)
}

async function getLinePushSettings(poolOrClient, shopId, { includeToken = false } = {}) {
  const map = await getShopSettings(poolOrClient, shopId, SETTING_KEYS)
  const shopToken = map.line_channel_access_token || ''
  const token = resolveChannelAccessToken(shopToken)
  return {
    enabled: map.line_push_enabled !== 'false' && Boolean(token && map.line_push_to_id),
    pushEnabledFlag: map.line_push_enabled !== 'false',
    channelAccessToken: includeToken ? token : undefined,
    tokenMasked: maskToken(token),
    tokenConfigured: Boolean(token),
    tokenFromEnv: Boolean(String(process.env.LINE_BOT_CHANNEL_ACCESS_TOKEN || '').trim()),
    pushToId: map.line_push_to_id || '',
    notifyTemplate: map.line_booking_notify_template || DEFAULT_TEMPLATE,
  }
}

async function setLinePushSettings(poolOrClient, shopId, partial) {
  const entries = {}
  if (typeof partial.enabled === 'boolean') {
    entries.line_push_enabled = partial.enabled ? 'true' : 'false'
  }
  if (partial.pushToId != null) {
    entries.line_push_to_id = String(partial.pushToId).trim()
  }
  if (partial.notifyTemplate != null) {
    entries.line_booking_notify_template = String(partial.notifyTemplate)
  }
  if (partial.channelAccessToken != null) {
    const token = String(partial.channelAccessToken).trim()
    if (token) entries.line_channel_access_token = token
  }
  if (Object.keys(entries).length) {
    await setShopSettings(poolOrClient, shopId, entries)
  }
  return getLinePushSettings(poolOrClient, shopId)
}

module.exports = {
  DEFAULT_TEMPLATE,
  getLinePushSettings,
  setLinePushSettings,
  resolveChannelAccessToken,
  validateLineAccessToken,
  logLineBotTokenStatus,
}
