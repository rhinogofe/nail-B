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
}
