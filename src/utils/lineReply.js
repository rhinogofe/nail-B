async function replyLineMessage({ channelAccessToken, replyToken, text }) {
  if (!channelAccessToken || !replyToken || !text) {
    return { ok: false, skipped: true, reason: 'missing_config' }
  }

  const res = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${channelAccessToken}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text: String(text).slice(0, 5000) }],
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { ok: false, status: res.status, error: body || res.statusText }
  }

  return { ok: true }
}

module.exports = { replyLineMessage }
