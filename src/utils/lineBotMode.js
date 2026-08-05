function isCentralLineBotEnabled() {
  const token = String(process.env.LINE_BOT_CHANNEL_ACCESS_TOKEN || '').trim()
  const secret = String(process.env.LINE_BOT_CHANNEL_SECRET || '').trim()
  return Boolean(token && secret)
}

function getCentralLineBotCredentials() {
  if (!isCentralLineBotEnabled()) {
    return { channelAccessToken: '', channelSecret: '' }
  }
  return {
    channelAccessToken: String(process.env.LINE_BOT_CHANNEL_ACCESS_TOKEN || '').trim(),
    channelSecret: String(process.env.LINE_BOT_CHANNEL_SECRET || '').trim(),
  }
}

module.exports = {
  isCentralLineBotEnabled,
  getCentralLineBotCredentials,
}
