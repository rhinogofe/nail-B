const express = require('express')
const { verifyLineSignature } = require('../utils/lineWebhookVerify')
const { handleLineWebhookPayload } = require('../utils/lineWebhookHandler')

const router = express.Router()

router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  const channelSecret = process.env.LINE_BOT_CHANNEL_SECRET
  if (!channelSecret) {
    return res.status(503).json({ error: 'LINE_BOT_CHANNEL_SECRET not configured' })
  }

  const signature = req.get('x-line-signature')
  if (!verifyLineSignature(req.body, signature, channelSecret)) {
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
    console.log(`lineWebhook: received ${eventCount} event(s)`)
  }

  handleLineWebhookPayload(payload).catch((err) => {
    console.error('lineWebhook:', err.message)
  })
})

module.exports = router
