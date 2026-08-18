function formatHmLabel(hour, minute = 0) {
  const h = Number(hour)
  const m = Number(minute ?? 0)
  const min = Number.isInteger(m) && m >= 0 && m <= 59 ? m : 0
  if (!Number.isFinite(h)) return `${hour}:${String(min).padStart(2, '0')}`
  if (h >= 24) {
    const clockH = h % 24
    return `${String(clockH).padStart(2, '0')}:${String(min).padStart(2, '0')} (วันถัดไป)`
  }
  if (!Number.isInteger(h) || h < 0 || h > 23) return `${hour}:${String(min).padStart(2, '0')}`
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

module.exports = {
  formatHmLabel,
}
