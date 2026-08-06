const { normalizeChatBody } = require('./chatAccess')
const { parseBase64Image, saveChatImage, deleteChatImageFile } = require('./chatImages')

async function createChatMessage(pool, {
  shopId,
  userId,
  senderRole,
  senderId,
  body,
  imageData,
  imageMime,
  relatedUserId,
}) {
  const text = normalizeChatBody(body)
  let imageUrl = null
  let savedFilename = null

  if (imageData) {
    const parsed = parseBase64Image(imageData, imageMime)
    if (parsed?.error) {
      const err = new Error(parsed.error)
      err.status = 400
      throw err
    }
    savedFilename = await saveChatImage(shopId, parsed.buffer, parsed.ext)
    imageUrl = savedFilename
  }

  if (!text && !imageUrl) {
    const err = new Error('กรุณาพิมพ์ข้อความหรือแนบรูป')
    err.status = 400
    throw err
  }

  try {
    const result = await pool.query(
      `
        INSERT INTO chat_messages (shop_id, user_id, sender_role, sender_id, body, image_url, related_user_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, body, image_url, sender_role, sender_id, related_user_id, read_at, created_at
      `,
      [shopId, userId, senderRole, senderId, text, imageUrl, relatedUserId || null]
    )
    return result.rows[0]
  } catch (err) {
    if (savedFilename) {
      await deleteChatImageFile(shopId, savedFilename)
    }
    throw err
  }
}

const MESSAGE_FIELDS = 'id, body, image_url, sender_role, sender_id, related_user_id, read_at, created_at'

module.exports = {
  createChatMessage,
  MESSAGE_FIELDS,
}
