const crypto = require('crypto')

function verifyLineSignature(rawBody, signature, channelSecret) {
  if (!signature || !channelSecret) return false
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8')
  const digest = crypto
    .createHmac('sha256', channelSecret)
    .update(body)
    .digest('base64')
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature))
  } catch {
    return false
  }
}

module.exports = { verifyLineSignature }
