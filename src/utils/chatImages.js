const fs = require('fs').promises
const path = require('path')
const crypto = require('crypto')
const { getChatUploadRoot } = require('./uploadPaths')

function uploadRoot() {
  return getChatUploadRoot()
}
const MAX_BYTES = 2 * 1024 * 1024
const DEFAULT_RETENTION_HOURS = 24
const DEFAULT_CACHE_MAX_AGE_SEC = 86400

function getChatImageRetentionHours() {
  const hours = Number(process.env.CHAT_IMAGE_RETENTION_HOURS)
  if (!Number.isFinite(hours) || hours <= 0) return DEFAULT_RETENTION_HOURS
  return hours
}

function getChatImageCacheMaxAge() {
  const seconds = Number(process.env.CHAT_IMAGE_CACHE_MAX_AGE)
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_CACHE_MAX_AGE_SEC
  return Math.floor(seconds)
}
const MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
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
  if (buffer.length > MAX_BYTES) return { error: 'รูปใหญ่เกิน 2MB' }

  return { buffer, ext, mime }
}

function shopImagePath(shopId, filename) {
  const safeName = path.basename(String(filename || ''))
  if (!safeName || safeName !== filename || safeName.includes('..')) return null
  return path.join(uploadRoot(), shopId, safeName)
}

async function saveChatImage(shopId, buffer, ext) {
  const dir = path.join(uploadRoot(), shopId)
  await fs.mkdir(dir, { recursive: true })
  const filename = `${crypto.randomUUID()}.${ext}`
  await fs.writeFile(path.join(dir, filename), buffer)
  return filename
}

async function deleteChatImageFile(shopId, filename) {
  const filePath = shopImagePath(shopId, filename)
  if (!filePath) return
  try {
    await fs.unlink(filePath)
  } catch {
    /* ignore missing files */
  }
}

async function deleteChatImagesForConversation(pool, shopId, userId) {
  const result = await pool.query(
    `
      SELECT image_url
      FROM chat_messages
      WHERE shop_id = $1 AND user_id = $2 AND image_url IS NOT NULL
    `,
    [shopId, userId]
  )
  await Promise.all(
    result.rows.map((row) => deleteChatImageFile(shopId, row.image_url))
  )
}

async function readChatImageFile(shopId, filename) {
  const filePath = shopImagePath(shopId, filename)
  if (!filePath) return null
  try {
    return await fs.readFile(filePath)
  } catch {
    return null
  }
}

function formatLastMessagePreview(body, imageUrl) {
  const text = String(body || '').trim()
  if (imageUrl && !text) return '[รูปภาพ]'
  if (imageUrl && text) return text
  return text
}

async function expireOldChatImages(pool) {
  const hours = getChatImageRetentionHours()
  const result = await pool.query(
    `
      SELECT id, shop_id, image_url
      FROM chat_messages
      WHERE image_url IS NOT NULL
        AND created_at < NOW() - ($1::text || ' hours')::interval
    `,
    [String(hours)]
  )
  if (!result.rows.length) return 0

  await Promise.all(
    result.rows.map((row) => deleteChatImageFile(row.shop_id, row.image_url))
  )

  const ids = result.rows.map((row) => row.id)
  await pool.query(
    `
      UPDATE chat_messages
      SET image_url = NULL
      WHERE id = ANY($1::uuid[])
    `,
    [ids]
  )

  return result.rows.length
}

module.exports = {
  parseBase64Image,
  saveChatImage,
  deleteChatImageFile,
  deleteChatImagesForConversation,
  readChatImageFile,
  formatLastMessagePreview,
  expireOldChatImages,
  getChatImageRetentionHours,
  getChatImageCacheMaxAge,
  MIME_EXT,
}
