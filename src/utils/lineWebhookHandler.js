const { getPool } = require('../db/pool')
const { setLinePushSettings, getLinePushSettings } = require('./linePushSettings')
const { replyLineMessage } = require('./lineReply')

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const RESERVED_SLUGS = new Set(['bookings', 'admin', 'login', 'profile', 'payment', 'reviews', 'api'])

function extractSlugFromMessage(text) {
  if (!text || typeof text !== 'string') return null
  const trimmed = text.trim()

  const urlMatch = trimmed.match(/https?:\/\/[^\s/]+\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/|$)/i)
  if (urlMatch) {
    const slug = urlMatch[1].toLowerCase()
    if (SLUG_RE.test(slug) && !RESERVED_SLUGS.has(slug)) return slug
  }

  const pathMatch = trimmed.match(/^\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/bookings)?\/?$/i)
  if (pathMatch) {
    const slug = pathMatch[1].toLowerCase()
    if (SLUG_RE.test(slug) && !RESERVED_SLUGS.has(slug)) return slug
  }

  const bare = trimmed.toLowerCase()
  if (SLUG_RE.test(bare) && !RESERVED_SLUGS.has(bare)) return bare

  return null
}

function getPushToIdFromSource(source) {
  if (!source) return null
  if (source.type === 'user' && source.userId) return source.userId
  if (source.type === 'group' && source.groupId) return source.groupId
  if (source.type === 'room' && source.roomId) return source.roomId
  return null
}

function getBotAccessToken() {
  return process.env.LINE_BOT_CHANNEL_ACCESS_TOKEN || ''
}

async function resolveAccessToken(pool, shopId) {
  const envToken = getBotAccessToken()
  if (envToken) return envToken
  const settings = await getLinePushSettings(pool, shopId, { includeToken: true })
  return settings.channelAccessToken || ''
}

async function lookupShopBySlug(pool, slug) {
  const result = await pool.query(
    `SELECT id, slug, name FROM shops WHERE slug = $1 AND is_active = true LIMIT 1`,
    [slug]
  )
  return result.rows[0] || null
}

async function handleLineWebhookEvent(event) {
  if (event.type !== 'message' || event.message?.type !== 'text') {
    return
  }

  const replyToken = event.replyToken
  const text = event.message.text
  const pushToId = getPushToIdFromSource(event.source)

  if (!pushToId) return

  const helpText = `สวัสดีครับ 👋\n\nพิมพ์ slug ร้านของคุณเพื่อผูกรับแจ้งเตือนคิวจอง\n\nตัวอย่าง:\ncopytest\n/copytest/bookings\n\nslug ดูได้ที่แอดมิน → ร้าน / สาขา`

  const slug = extractSlugFromMessage(text)
  if (!slug) {
    const accessToken = getBotAccessToken()
    if (replyToken && accessToken) {
      await replyLineMessage({ channelAccessToken: accessToken, replyToken, text: helpText }).catch(() => null)
    }
    return
  }

  const pool = getPool()
  const shop = await lookupShopBySlug(pool, slug)
  const accessToken = shop ? await resolveAccessToken(pool, shop.id) : getBotAccessToken()
  if (!shop) {
    if (replyToken && accessToken) {
      await replyLineMessage({
        channelAccessToken: accessToken,
        replyToken,
        text: `ไม่พบร้าน slug "${slug}"\n\nตรวจสอบ slug ในแอดมิน → ร้าน / สาขา แล้วลองใหม่`,
      }).catch(() => null)
    }
    return
  }

  const partial = { pushToId, enabled: true }
  const envToken = getBotAccessToken()
  const existing = await getLinePushSettings(pool, shop.id, { includeToken: true })
  if (envToken && !existing.channelAccessToken) {
    partial.channelAccessToken = envToken
  }

  await setLinePushSettings(pool, shop.id, partial)

  const destLabel = event.source?.type === 'group'
    ? 'กลุ่ม LINE นี้'
    : 'LINE นี้'

  if (replyToken && accessToken) {
    await replyLineMessage({
      channelAccessToken: accessToken,
      replyToken,
      text: `✅ ผูกแจ้งเตือนแล้ว\n\nร้าน: ${shop.name}\nslug: ${shop.slug}\nส่งไปที่: ${destLabel}\nID: ${pushToId}\n\nเมื่อลูกค้าจองคิว จะแจ้งเตือนที่นี่อัตโนมัติ`,
    }).catch(() => null)
  }
}

async function handleLineWebhookPayload(payload) {
  const events = payload?.events
  if (!Array.isArray(events) || !events.length) return

  await Promise.all(events.map((event) => handleLineWebhookEvent(event).catch((err) => {
    console.error('lineWebhook event:', err.message)
  })))
}

module.exports = {
  extractSlugFromMessage,
  getPushToIdFromSource,
  handleLineWebhookPayload,
}
