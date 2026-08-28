const { EventEmitter } = require('events')

const emitters = new Map()

function getEmitter(shopId) {
  const key = String(shopId)
  if (!emitters.has(key)) {
    const emitter = new EventEmitter()
    emitter.setMaxListeners(100)
    emitters.set(key, emitter)
  }
  return emitters.get(key)
}

function emitBookingChanged(shopId, payload = {}) {
  if (shopId == null) return
  getEmitter(shopId).emit('change', {
    type: payload.type || 'updated',
    booking_date: payload.booking_date || null,
    booking_id: payload.booking_id || null,
    at: new Date().toISOString(),
  })
}

function emitShopLive(shopId, type, extra = {}) {
  emitBookingChanged(shopId, { type, ...extra })
}

function subscribeBookingEvents(shopId, listener) {
  const emitter = getEmitter(shopId)
  emitter.on('change', listener)
  return () => emitter.off('change', listener)
}

function attachShopEventStream(req, res, shopId) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()
  res.write(': connected\n\n')

  const unsubscribe = subscribeBookingEvents(shopId, (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  })

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n')
  }, 30000)

  req.on('close', () => {
    clearInterval(heartbeat)
    unsubscribe()
  })
}

module.exports = {
  emitBookingChanged,
  emitShopLive,
  subscribeBookingEvents,
  attachShopEventStream,
}
