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

function subscribeBookingEvents(shopId, listener) {
  const emitter = getEmitter(shopId)
  emitter.on('change', listener)
  return () => emitter.off('change', listener)
}

module.exports = {
  emitBookingChanged,
  subscribeBookingEvents,
}
