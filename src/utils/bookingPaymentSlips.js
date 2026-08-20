const fs = require('fs').promises
const path = require('path')
const crypto = require('crypto')
const { getUploadRoot } = require('./uploadPaths')
const { parseBase64Image } = require('./usageRenewalSlips')

const MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

function bookingSlipDir() {
  return path.join(getUploadRoot(), 'booking-slips')
}

function bookingSlipPath(filename) {
  const safeName = path.basename(String(filename || ''))
  if (!safeName || safeName !== filename || safeName.includes('..')) return null
  return path.join(bookingSlipDir(), safeName)
}

async function saveBookingPaymentSlip(buffer, ext) {
  const dir = bookingSlipDir()
  await fs.mkdir(dir, { recursive: true })
  const filename = `${crypto.randomUUID()}.${ext}`
  await fs.writeFile(path.join(dir, filename), buffer)
  return filename
}

async function deleteBookingPaymentSlip(filename) {
  const filePath = bookingSlipPath(filename)
  if (!filePath) return
  try {
    await fs.unlink(filePath)
  } catch {
    /* ignore */
  }
}

async function deletePaymentSlipByBookingId(poolOrClient, bookingId) {
  const result = await poolOrClient.query(
    `SELECT id, slip_filename FROM booking_payment_slips WHERE booking_id = $1 LIMIT 1`,
    [bookingId]
  )
  const row = result.rows[0]
  if (!row) return false
  await deleteBookingPaymentSlip(row.slip_filename)
  await poolOrClient.query(`DELETE FROM booking_payment_slips WHERE id = $1`, [row.id])
  return true
}

async function isPaymentSlipUploadEnabled(poolOrClient, shopId) {
  const { getUiSettings } = require('./shopUiSettings')
  const ui = await getUiSettings(poolOrClient, shopId)
  const raw = String(ui.ui_payment_slip_upload_enabled || '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

async function markBookingSlipConfirmed(poolOrClient, bookingId, reviewerUserId = null) {
  const result = await poolOrClient.query(
    `
      UPDATE booking_payment_slips
      SET
        status = 'confirmed',
        reviewed_by_user_id = $1,
        reviewed_at = NOW(),
        updated_at = NOW()
      WHERE booking_id = $2
        AND status = 'pending'
      RETURNING id
    `,
    [reviewerUserId, bookingId]
  )
  return result.rowCount > 0
}

async function readBookingPaymentSlip(filename) {
  const filePath = bookingSlipPath(filename)
  if (!filePath) return null
  try {
    return await fs.readFile(filePath)
  } catch {
    return null
  }
}

function mapSlipRow(row) {
  if (!row) return null
  return {
    id: row.id,
    booking_id: row.booking_id,
    shop_id: row.shop_id,
    slip_filename: row.slip_filename,
    status: row.status,
    reviewed_by_user_id: row.reviewed_by_user_id,
    reviewed_at: row.reviewed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    booking_date: row.booking_date,
    start_hour: row.start_hour,
    start_minute: row.start_minute,
    end_hour: row.end_hour,
    end_minute: row.end_minute,
    booking_status: row.booking_status,
    user_name: row.user_name,
    user_email: row.user_email,
  }
}

module.exports = {
  parseBase64Image,
  saveBookingPaymentSlip,
  deleteBookingPaymentSlip,
  deletePaymentSlipByBookingId,
  isPaymentSlipUploadEnabled,
  markBookingSlipConfirmed,
  readBookingPaymentSlip,
  bookingSlipPath,
  mapSlipRow,
  MIME_EXT,
}
