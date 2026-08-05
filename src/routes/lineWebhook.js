const express = require('express')
const { getPool } = require('../db/pool')
const { verifyLineSignature } = require('../utils/lineWebhookVerify')
const { handleLineWebhookPayload } = require('../utils/lineWebhookHandler')
const { isCentralLineBotEnabled, getCentralLineBotCredentials } = require('../utils/lineBotMode')
const { getLinePushSettings } = require('../utils/linePushSettings')

const router = express.Router()
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

async function resolveWebhookSecret(shopSlug) {
  if (shopSlug) {
    const pool = getPool()
    const shopRes = await pool.query(
      `SELECT id, slug, name FROM shops WHERE slug = $1 AND is_active = true LIMIT 1`,
      [shopSlug]
    )
    const shop = shopRes.rows[0]
    if (!shop) return { error: 'shop_not_found', status: 404 }
    const settings = await getLinePushSettings(pool, shop.id, { includeSecret: true })
    if (!settings.uses_own_bot) {
      return {
        error: 'shop_uses_central_bot',
        status: 400,
      }
    }
    if (!settings.channelSecret) {
      return { error: 'shop_line_secret_missing', status: 503 }
    }
    return { shop, channelSecret: settings.channelSecret }
  }

  if (!isCentralLineBotEnabled()) {
    return { error: 'central_line_bot_disabled', status: 503 }
  }
  return { channelSecret: getCentralLineBotCredentials().channelSecret }
}

async function handleWebhook(req, res, shopSlug = null) {
  const normalizedSlug = shopSlug ? String(shopSlug).trim().toLowerCase() : null
  if (normalizedSlug && !SLUG_RE.test(normalizedSlug)) {
    return res.status(400).json({ error: 'Invalid shop slug' })
  }

  const resolved = await resolveWebhookSecret(normalizedSlug)
  if (resolved.error) {
    const messages = {
      shop_not_found: 'ไม่พบสาขา',
      shop_uses_central_bot: 'สาขานี้ใช้บอทกลาง — ตั้ง Webhook ที่ /api/line/webhook แล้วทักบอทกลางพร้อม slug',
      shop_line_secret_missing: 'สาขานี้ยังไม่ได้ตั้ง Channel Secret',
      central_line_bot_disabled: 'บอทกลางปิดอยู่ — ใช้ Webhook แบบ /api/line/webhook/{slug} ของแต่ละสาขา',
    }
    return res.status(resolved.status).json({ error: messages[resolved.error] || resolved.error })
  }

  const signature = req.get('x-line-signature')
  if (!verifyLineSignature(req.body, signature, resolved.channelSecret)) {
    return res.status(401).json({ error: 'Invalid signature' })
  }

  let payload
  try {
    payload = JSON.parse(req.body.toString('utf8'))
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' })
  }

  res.status(200).json({ ok: true })

  const eventCount = Array.isArray(payload?.events) ? payload.events.length : 0
  if (eventCount > 0) {
    console.log(`lineWebhook: received ${eventCount} event(s)${normalizedSlug ? ` shop=${normalizedSlug}` : ' central'}`)
  }

  handleLineWebhookPayload(payload, {
    shop: resolved.shop || null,
  }).catch((err) => {
    console.error('lineWebhook:', err.message)
  })
}

router.post('/', express.raw({ type: 'application/json' }), (req, res) => {
  handleWebhook(req, res, null)
})

router.post('/:shopSlug', express.raw({ type: 'application/json' }), (req, res) => {
  handleWebhook(req, res, req.params.shopSlug)
})

module.exports = router
