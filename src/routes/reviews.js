const router = require('express').Router()
const auth = require('../middleware/authMiddleware')
const { getPool } = require('../db/pool')
const { fetchTikTokThumbnail } = require('../utils/tiktokUrl')

async function enrichClipThumbnails(pool, rows) {
  const enriched = []
  for (const row of rows) {
    let thumbnail_url = row.thumbnail_url
    if (!thumbnail_url && row.tiktok_url) {
      thumbnail_url = await fetchTikTokThumbnail(row.tiktok_url)
      if (thumbnail_url) {
        await pool.query(
          `UPDATE showcase_clips SET thumbnail_url = $1, updated_at = NOW() WHERE id = $2`,
          [thumbnail_url, row.id]
        )
      }
    }
    enriched.push({ ...row, thumbnail_url })
  }
  return enriched
}

router.get('/clips', auth, async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.query(
      `
        SELECT id, tiktok_url, video_id, title, thumbnail_url, sort_order, created_at
        FROM showcase_clips
        WHERE is_active = true
        ORDER BY sort_order ASC, created_at DESC
      `
    )
    const clips = await enrichClipThumbnails(pool, result.rows)
    res.json(clips)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
