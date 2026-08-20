const fs = require('fs').promises
const path = require('path')
const crypto = require('crypto')
const { getUploadRoot } = require('./uploadPaths')

const MAX_BYTES = 5 * 1024 * 1024
const MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

function renewalSlipDir() {
  return path.join(getUploadRoot(), 'renewal')
}

function renewalSlipPath(filename) {
  const safeName = path.basename(String(filename || ''))
  if (!safeName || safeName !== filename || safeName.includes('..')) return null
  return path.join(renewalSlipDir(), safeName)
}

function parseBase64Image(imageData, imageMime) {
  if (!imageData) return null
  const mime = String(imageMime || '').toLowerCase().trim()
  const ext = MIME_EXT[mime]
  if (!ext) return { error: 'รองรับเฉพาะ JPG, PNG, WebP, GIF' }

  let b64 = String(imageData)
  const dataUrlMatch = b64.match(/^data:[^;]+;base64,(.+)$/i)
  if (dataUrlMatch) b64 = dataUrlMatch[1]

  let buffer
  try {
    buffer = Buffer.from(b64, 'base64')
  } catch {
    return { error: 'รูปภาพไม่ถูกต้อง' }
  }

  if (!buffer.length) return { error: 'รูปภาพว่าง' }
  if (buffer.length > MAX_BYTES) return { error: 'รูปใหญ่เกิน 5MB' }

  return { buffer, ext, mime }
}

async function saveRenewalSlip(buffer, ext) {
  const dir = renewalSlipDir()
  await fs.mkdir(dir, { recursive: true })
  const filename = `${crypto.randomUUID()}.${ext}`
  await fs.writeFile(path.join(dir, filename), buffer)
  return filename
}

async function deleteRenewalSlip(filename) {
  const filePath = renewalSlipPath(filename)
  if (!filePath) return
  try {
    await fs.unlink(filePath)
  } catch {
    /* ignore */
  }
}

async function readRenewalSlip(filename) {
  const filePath = renewalSlipPath(filename)
  if (!filePath) return null
  try {
    return await fs.readFile(filePath)
  } catch {
    return null
  }
}

module.exports = {
  parseBase64Image,
  saveRenewalSlip,
  deleteRenewalSlip,
  readRenewalSlip,
  renewalSlipPath,
  MIME_EXT,
}
