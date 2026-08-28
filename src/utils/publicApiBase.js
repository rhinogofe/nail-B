function resolvePublicApiBase(req) {
  const fromEnv = String(process.env.API_PUBLIC_URL || '').trim()
  if (fromEnv) return fromEnv.replace(/\/$/, '')

  const host = String(req.get('host') || '').trim()
  if (!host) return ''

  let proto = String(req.get('x-forwarded-proto') || req.protocol || 'https')
    .split(',')[0]
    .trim()

  const isLocal = /^localhost(:\d+)?$/i.test(host) || /^127\.0\.0\.1(:\d+)?$/i.test(host)
  if (!isLocal && proto === 'http') {
    proto = 'https'
  }

  return `${proto}://${host}`.replace(/\/$/, '')
}

module.exports = { resolvePublicApiBase }
