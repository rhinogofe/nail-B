const router = require('express').Router()
const { getPool } = require('../db/pool')
const { getBookingSiteContent, saveBookingSiteContent } = require('../utils/bookingSite')
const { isShopFeatureOn } = require('../utils/shopFeatureFlags')
const {
  isAllowedFolder,
  listFolderImages,
  saveFolderImage,
  parseBase64Image,
} = require('../utils/bookingSiteImages')

async function requireBookingSite(req, res, next) {
  try {
    const on = await isShopFeatureOn(getPool(), req.shop.id, 'feat_booking_site')
    if (!on) {
      return res.status(403).json({ error: 'สาขานี้ปิดเว็บไซต์ไว้', code: 'BOOKING_SITE_DISABLED' })
    }
    next()
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

router.use('/booking-site', requireBookingSite)

router.get('/booking-site', async (req, res) => {
  try {
    const pool = getPool()
    const content = await getBookingSiteContent(pool, req.shop)
    res.json(content)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/booking-site', async (req, res) => {
  try {
    const pool = getPool()
    const result = await saveBookingSiteContent(pool, req.shop, req.body)
    if (result.error) return res.status(400).json({ error: result.error })
    res.json({ ok: true, content: result.content })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/booking-site/images/:folder', async (req, res) => {
  const folder = String(req.params.folder || '')
  if (!isAllowedFolder(folder)) {
    return res.status(400).json({ error: 'ชื่อโฟลเดอร์ใช้ได้เฉพาะ a-z 0-9 - _' })
  }
  try {
    const listed = await listFolderImages(req.shop.id, req.shop.slug, folder)
    if (listed.error) return res.status(400).json({ error: listed.error })
    res.json({ files: listed.files })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/booking-site/upload/:folder', async (req, res) => {
  const folder = String(req.params.folder || '')
  if (!isAllowedFolder(folder)) {
    return res.status(400).json({ error: 'ชื่อโฟลเดอร์ใช้ได้เฉพาะ a-z 0-9 - _' })
  }
  const parsed = parseBase64Image(req.body?.image_data, req.body?.image_mime)
  if (!parsed) return res.status(400).json({ error: 'ต้องส่งรูปภาพ' })
  if (parsed.error) return res.status(400).json({ error: parsed.error })
  try {
    const saved = await saveFolderImage(req.shop.id, req.shop.slug, folder, parsed.buffer, parsed.ext)
    if (saved.error) return res.status(400).json({ error: saved.error })
    res.json({ url: saved.url })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
