async function pushLineMessage({ channelAccessToken, toId, text }) {
  if (!channelAccessToken || !toId || !text) {
    return { ok: false, skipped: true, reason: 'missing_config' }
  }

  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${channelAccessToken}`,
    },
    body: JSON.stringify({
      to: toId,
      messages: [{ type: 'text', text: String(text).slice(0, 5000) }],
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { ok: false, status: res.status, error: body || res.statusText }
  }

  return { ok: true }
}

module.exports = { pushLineMessage }
