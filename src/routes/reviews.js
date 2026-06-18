const router = require('express').Router()
const auth = require('../middleware/authMiddleware')
const { getPool } = require('../db/pool')

router.get('/clips', auth, async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.query(
      `
        SELECT id, tiktok_url, video_id, title, sort_order, created_at
        FROM showcase_clips
        WHERE is_active = true
        ORDER BY sort_order ASC, created_at DESC
      `
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
