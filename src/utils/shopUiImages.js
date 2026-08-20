const fs = require('fs').promises
const path = require('path')
const crypto = require('crypto')
const { getUiUploadRoot } = require('./uploadPaths')

function uploadRoot() {
  return getUiUploadRoot()
}
const MAX_BYTES = 3 * 1024 * 1024
const ALLOWED_KINDS = new Set(['logo', 'hero', 'kshop_qr'])
const MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

function isAllowedKind(kind) {
  return ALLOWED_KINDS.has(String(kind || '').toLowerCase())
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
  if (buffer.length > MAX_BYTES) return { error: 'รูปใหญ่เกิน 3MB' }

  return { buffer, ext, mime }
}

function shopImagePath(shopId, kind, filename) {
  if (!isAllowedKind(kind)) return null
  const safeName = path.basename(String(filename || ''))
  if (!safeName || safeName !== filename || safeName.includes('..')) return null
  return path.join(uploadRoot(), shopId, kind, safeName)
}

function buildUiImagePath(kind, filename) {
  return `/api/bookings/ui-images/${kind}/${filename}`
}

function parseStoredUiImagePath(url) {
  const u = String(url || '').trim()
  const match = u.match(/\/api\/bookings\/ui-images\/(logo|hero|kshop_qr)\/([^/?#]+)$/i)
  if (!match) return null
  return { kind: match[1].toLowerCase(), filename: match[2] }
}

async function saveUiImage(shopId, kind, buffer, ext) {
  if (!isAllowedKind(kind)) throw new Error('ประเภทรูปไม่ถูกต้อง')
  const dir = path.join(uploadRoot(), shopId, kind)
  await fs.mkdir(dir, { recursive: true })
  const filename = `${crypto.randomUUID()}.${ext}`
  await fs.writeFile(path.join(dir, filename), buffer)
  return { filename, url: buildUiImagePath(kind, filename) }
}

async function deleteUiImageFile(shopId, kind, filename) {
  const filePath = shopImagePath(shopId, kind, filename)
  if (!filePath) return
  try {
    await fs.unlink(filePath)
  } catch {
    /* ignore missing files */
  }
}

async function deleteStoredUiImage(shopId, storedUrl) {
  const parsed = parseStoredUiImagePath(storedUrl)
  if (!parsed) return
  await deleteUiImageFile(shopId, parsed.kind, parsed.filename)
}

async function readUiImageFile(shopId, kind, filename) {
  const filePath = shopImagePath(shopId, kind, filename)
  if (!filePath) return null
  try {
    return await fs.readFile(filePath)
  } catch {
    return null
  }
}

module.exports = {
  ALLOWED_KINDS,
  MIME_EXT,
  parseBase64Image,
  saveUiImage,
  deleteUiImageFile,
  deleteStoredUiImage,
  readUiImageFile,
  buildUiImagePath,
  parseStoredUiImagePath,
  isAllowedKind,
}
