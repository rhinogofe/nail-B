const router = require('express').Router()
const auth = require('../middleware/authMiddleware')
const { getPool } = require('../db/pool')
const { fetchShowcaseThumbnail, showcaseReferer } = require('../utils/showcaseUrl')

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

async function downloadThumbnailImage(thumbnailUrl, source) {
  return fetch(thumbnailUrl, {
    headers: {
      'User-Agent': BROWSER_UA,
      Referer: showcaseReferer(source),
    },
  })
}

async function resolveClipThumbnail(pool, clip) {
  const source = clip.source || 'tiktok'
  const tried = new Set()
  const candidates = []

  if (clip.thumbnail_url) candidates.push(clip.thumbnail_url)

  const freshUrl = await fetchShowcaseThumbnail(source, clip.tiktok_url)
  if (freshUrl) candidates.push(freshUrl)

  for (const url of candidates) {
    if (!url || tried.has(url)) continue
    tried.add(url)

    const imageRes = await downloadThumbnailImage(url, source)
    if (!imageRes.ok) continue

    if (url !== clip.thumbnail_url) {
      await pool.query(
        `UPDATE showcase_clips SET thumbnail_url = $1, updated_at = NOW() WHERE id = $2`,
        [url, clip.id]
      )
    }

    return imageRes
  }

  return null
}

async function enrichClipThumbnails(pool, rows) {
  const enriched = []
  for (const row of rows) {
    if (!row.thumbnail_url) {
      const source = row.source || 'tiktok'
      const freshUrl = await fetchShowcaseThumbnail(source, row.tiktok_url)
      if (freshUrl) {
        await pool.query(
          `UPDATE showcase_clips SET thumbnail_url = $1, updated_at = NOW() WHERE id = $2`,
          [freshUrl, row.id]
        )
        row.thumbnail_url = freshUrl
      }
    }
    enriched.push({ ...row })
  }
  return enriched
}

router.get('/clips/:id/thumbnail', (req, res, next) => {
  if (!req.headers.authorization && typeof req.query.token === 'string' && req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`
  }
  return auth(req, res, next)
}, async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.query(
      `SELECT id, source, tiktok_url, thumbnail_url FROM showcase_clips WHERE id = $1`,
      [req.params.id]
    )
    if (!result.rows.length) {
      return res.status(404).json({ error: 'ไม่พบคลิป' })
    }

    const imageRes = await resolveClipThumbnail(pool, result.rows[0])
    if (!imageRes) {
      return res.status(404).json({ error: 'ดึงรูปปกไม่สำเร็จ' })
    }

    const buffer = Buffer.from(await imageRes.arrayBuffer())
    res.set('Content-Type', imageRes.headers.get('content-type') || 'image/jpeg')
    res.set('Cache-Control', 'public, max-age=3600')
    res.set('Cross-Origin-Resource-Policy', 'cross-origin')
    res.send(buffer)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/clips', auth, async (req, res) => {
  try {
    const pool = getPool()
    const result = await pool.query(
      `
        SELECT id, source, tiktok_url, video_id, title, thumbnail_url, sort_order, created_at
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
