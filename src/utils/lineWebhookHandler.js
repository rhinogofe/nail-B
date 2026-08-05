const { getPool } = require('../db/pool')
const { setLinePushSettings, getLinePushSettings } = require('./linePushSettings')
const { isCentralLineBotEnabled, getCentralLineBotCredentials } = require('./lineBotMode')
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

async function resolveAccessToken(pool, shopId) {
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

async function linkShopPushTarget(pool, shop, pushToId, accessToken, replyToken) {
  const existing = await getLinePushSettings(pool, shop.id, { includeToken: true })
  await setLinePushSettings(pool, shop.id, { pushToId })
  console.log(`lineWebhook: linked shop "${shop.slug}" → ${pushToId}`)

  const destLabel = 'LINE นี้'
  const enabledNow = existing.pushEnabledFlag
  const linkNote = enabledNow
    ? 'เมื่อลูกค้าจองคิว จะแจ้งเตือนที่นี่อัตโนมัติ'
    : 'แจ้งเตือนยังปิดอยู่ — แอดมินหลักต้องเปิดให้ก่อนจึงจะส่งเมื่อมีคิวจอง'

  if (replyToken && accessToken) {
    const reply = await replyLineMessage({
      channelAccessToken: accessToken,
      replyToken,
      text: `✅ ผูกรับแจ้งเตือนแล้ว\n\nร้าน: ${shop.name}\nslug: ${shop.slug}\nส่งไปที่: ${destLabel}\nID: ${pushToId}\n\n${linkNote}`,
    }).catch((err) => ({ ok: false, error: err.message }))
    if (!reply?.ok) {
      console.error('lineWebhook reply failed:', reply?.status, reply?.error)
    }
  } else if (replyToken && !accessToken) {
    console.error('lineWebhook: linked OK but no access token to reply')
  }
}

async function handleLineWebhookEvent(event, { shop: shopFromRoute = null } = {}) {
  if (event.type !== 'message' || event.message?.type !== 'text') {
    return
  }

  const replyToken = event.replyToken
  const text = event.message.text
  const pushToId = getPushToIdFromSource(event.source)
  if (!pushToId) return

  const pool = getPool()

  if (shopFromRoute) {
    const accessToken = await resolveAccessToken(pool, shopFromRoute.id)
    await linkShopPushTarget(pool, shopFromRoute, pushToId, accessToken, replyToken)
    return
  }

  const helpText = `สวัสดีครับ 👋\n\nพิมพ์ slug ร้านของคุณเพื่อผูกรับแจ้งเตือนคิวจอง\n\nตัวอย่าง:\ncopytest\n/copytest/bookings\n\nslug ดูได้ที่แอดมิน → ร้าน / สาขา`

  const slug = extractSlugFromMessage(text)
  const centralToken = isCentralLineBotEnabled() ? getCentralLineBotCredentials().channelAccessToken : ''

  if (!slug) {
    if (replyToken && centralToken) {
      await replyLineMessage({ channelAccessToken: centralToken, replyToken, text: helpText }).catch(() => null)
    }
    return
  }

  const shop = await lookupShopBySlug(pool, slug)
  const accessToken = shop ? await resolveAccessToken(pool, shop.id) : centralToken
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

  await linkShopPushTarget(pool, shop, pushToId, accessToken, replyToken)
}

async function handleLineWebhookPayload(payload, { shop = null } = {}) {
  const events = payload?.events
  if (!Array.isArray(events) || !events.length) return

  await Promise.all(events.map((event) => handleLineWebhookEvent(event, { shop }).catch((err) => {
    console.error('lineWebhook event:', err.message)
  })))
}

module.exports = {
  extractSlugFromMessage,
  getPushToIdFromSource,
  handleLineWebhookPayload,
}
