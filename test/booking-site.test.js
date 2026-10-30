const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs').promises
const path = require('path')
const os = require('os')
const {
  buildDefaultContent,
  validateContent,
  parseStoredContent,
  withBookingFallback,
  normalizeLegacyContent,
  resolveAboutMap,
  bookingPathForShop,
} = require('../src/utils/bookingSite')
const {
  isAllowedFolder,
  isAllowedFilename,
  shopFilePath,
  buildImagePath,
  listFolderImages,
  saveFolderImage,
} = require('../src/utils/bookingSiteImages')
const { collectShopFileRefs, purgeShopUploadFiles } = require('../src/utils/deleteShopFiles')

test('buildDefaultContent uses shop name and booking path', () => {
  const content = buildDefaultContent({ slug: 'silom', name: 'Nail Silom' })
  assert.equal(content.site.name, 'Nail Silom')
  assert.equal(content.site.logoText, 'NAILSILOM')
  assert.equal(content.site.bookingUrl, '/silom/bookings')
  assert.ok(Array.isArray(content.hero) && content.hero.length >= 1)
  assert.deepEqual(content.hero.map((s) => s.tab), ['หน้าแรก', 'บริการ', 'โปรโมชั่น', 'รีวิว'])
  assert.equal(content.hero[0].showBooking, true)
  assert.equal(content.theme.bg, '#fbf4f1')
  assert.equal(content.nav.find((n) => n.section === 'dining').show, false)
  assert.ok(Array.isArray(content.rooms) && content.rooms.length >= 1)
})

test('normalizeLegacyContent replaces atmosphere tab and stock dark theme', () => {
  const next = normalizeLegacyContent({
    site: { name: 'X' },
    hero: [
      { tab: 'บริการ', title: 'A' },
      { tab: 'บรรยากาศ', title: 'B' },
      { tab: 'โปรโมชั่น', title: 'C' },
      { tab: 'รีวิว', title: 'D' },
    ],
    nav: [
      { section: 'rooms', label: 'บริการ', show: true },
      { section: 'dining', label: 'บรรยากาศ', show: true },
      { section: 'news', label: 'ข่าวสาร', show: true },
    ],
    dining: { title: 'บรรยากาศที่จำได้นาน' },
    newsHeading: 'ข่าวสารล่าสุด',
    theme: { bg: '#070605', heroBtnBg: '#ffffff' },
  })
  assert.deepEqual(next.hero.map((s) => s.tab), ['หน้าแรก', 'บริการ', 'โปรโมชั่น', 'รีวิว'])
  assert.equal(next.nav[0].section, 'top')
  assert.equal(next.nav.find((n) => n.section === 'dining').show, false)
  assert.equal(next.nav.find((n) => n.section === 'news').label, 'รีวิว')
  assert.equal(next.newsHeading, 'รีวิว')
  assert.equal(next.theme.bg, '#fbf4f1')
})

test('normalizeLegacyContent moves stock about to shop address at the end', () => {
  const next = normalizeLegacyContent({
    site: { name: 'X' },
    hero: [{ tab: 'หน้าแรก', title: 'A' }],
    nav: [
      { section: 'top', label: 'หน้าแรก', show: true },
      { section: 'rooms', label: 'บริการ', show: true },
      { section: 'promo', label: 'โปรโมชั่น', show: true },
      { section: 'news', label: 'รีวิว', show: true },
      { section: 'book', label: 'จองเลย', show: true },
      { section: 'about', label: 'เกี่ยวกับ', show: false },
      { section: 'dining', label: 'บรรยากาศ', show: false },
      { section: 'contact', label: 'ติดต่อ', show: false },
    ],
    about: { title: 'ร้านที่ทำให้คุณอยากกลับมาอีก', text: 'x', showImage: true, image: '' },
  })
  assert.equal(next.layoutVersion, 2)
  assert.equal(next.about.title, 'ที่อยู่ร้าน')
  assert.deepEqual(
    next.nav.map((n) => n.section),
    ['top', 'rooms', 'news', 'promo', 'dining', 'about', 'book', 'contact'],
  )
  const about = next.nav.find((n) => n.section === 'about')
  assert.equal(about.label, 'ที่อยู่ร้าน')
  assert.equal(about.show, true)
})

test('normalizeLegacyContent reorders older about-first stock nav', () => {
  const next = normalizeLegacyContent({
    site: { name: 'X' },
    hero: [{ tab: 'หน้าแรก', title: 'A' }],
    nav: ['top', 'about', 'rooms', 'promo', 'dining', 'news', 'contact', 'book']
      .map((section) => ({ section, label: section, show: section !== 'dining' })),
    about: { title: 'ร้านที่ทำให้คุณอยากกลับมาอีก', text: 'x' },
  })
  assert.deepEqual(
    next.nav.map((n) => n.section),
    ['top', 'rooms', 'news', 'promo', 'dining', 'about', 'book', 'contact'],
  )
})

test('normalizeLegacyContent keeps custom about copy and custom order', () => {
  const nav = [
    { section: 'top', label: 'หน้าแรก', show: true },
    { section: 'news', label: 'รีวิว', show: true },
    { section: 'rooms', label: 'บริการ', show: true },
    { section: 'promo', label: 'โปรโมชั่น', show: true },
  ]
  const next = normalizeLegacyContent({
    site: { name: 'X' },
    hero: [{ tab: 'หน้าแรก', title: 'A' }],
    nav: nav.map((n) => ({ ...n })),
    about: { title: 'ร้านของฉัน', text: 'เล่าเรื่องร้าน' },
  })
  assert.equal(next.about.title, 'ร้านของฉัน')
  assert.deepEqual(next.nav.map((n) => n.section), nav.map((n) => n.section))
})

test('resolveAboutMap builds embed from own Google Maps link and clears when removed', async () => {
  const content = { about: { mapUrl: ' https://www.google.com/maps/place/Nail/@13.7307,100.5418,17z ' } }
  await resolveAboutMap(content)
  assert.equal(content.about.mapUrl, 'https://www.google.com/maps/place/Nail/@13.7307,100.5418,17z')
  assert.match(content.about.mapEmbedUrl, /13\.7307/)
  assert.match(content.about.mapEmbedUrl, /output=embed/)
  assert.equal(content.about.mapEmbedFor, content.about.mapUrl)

  content.about.mapUrl = ''
  await resolveAboutMap(content)
  assert.equal(content.about.mapEmbedUrl, '')
})

test('validateContent keeps service card colors', () => {
  const ok = validateContent({
    site: { name: 'A', bookingUrl: '/a/bookings' },
    hero: [{ title: 'Hi' }],
    theme: { roomTitle: '#111111', roomText: '#555555', roomLink: '#8b3a2a' },
    rooms: [{
      name: 'ทาสีเจลมือ',
      titleColor: '#1a1a1a',
      textColor: '#5a534c',
      linkColor: '#8b3a2a',
    }],
  })
  assert.equal(ok.error, undefined)
  assert.equal(ok.content.theme.roomTitle, '#111111')
  assert.equal(ok.content.rooms[0].titleColor, '#1a1a1a')
  assert.equal(ok.content.rooms[0].textColor, '#5a534c')
  assert.equal(ok.content.rooms[0].linkColor, '#8b3a2a')
})

test('validateContent rejects missing hero and oversized payload', () => {
  assert.equal(validateContent(null).error, 'ข้อมูลไม่ถูกต้อง')
  assert.equal(validateContent({ site: {} }).error, 'ข้อมูลไม่ถูกต้อง')
  assert.equal(validateContent({ site: {}, hero: [] }).error, 'ข้อมูลไม่ถูกต้อง')
  const ok = validateContent({
    site: { name: 'A', bookingUrl: '/a/bookings' },
    hero: [{ title: 'Hi' }],
  })
  assert.equal(ok.error, undefined)
  assert.equal(ok.content.site.name, 'A')
})

test('parseStoredContent and booking fallback', () => {
  assert.equal(parseStoredContent('not-json'), null)
  assert.equal(parseStoredContent('{"site":{}}'), null)
  const parsed = parseStoredContent(JSON.stringify({
    site: { name: 'X', bookingUrl: '' },
    hero: [{ title: 'H' }],
  }))
  const filled = withBookingFallback(parsed, { slug: 'branch-one' })
  assert.equal(filled.site.bookingUrl, '/branch-one/bookings')
  assert.equal(bookingPathForShop({ slug: 'default' }), '/default/bookings')
})

test('booking-site image folder and filename guards', () => {
  assert.equal(isAllowedFolder('hero'), true)
  assert.equal(isAllowedFolder('spa-hands'), true)
  assert.equal(isAllowedFolder('../etc'), false)
  assert.equal(isAllowedFolder('a/b'), false)
  assert.equal(isAllowedFilename('ab12cd.jpg'), true)
  assert.equal(isAllowedFilename('..png'), false)
  assert.equal(isAllowedFilename('x.exe'), false)
  assert.equal(shopFilePath('shop', '../x', 'ab.jpg'), null)
  assert.match(buildImagePath('silom', 'hero', 'ab.jpg'), /\/api\/shops\/silom\/booking-site\/images\/hero\/ab\.jpg/)
})

test('save and list booking-site images under shop folder', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nail-booking-site-'))
  const prev = process.env.UPLOAD_ROOT
  process.env.UPLOAD_ROOT = root
  try {
    const shopId = '33333333-3333-3333-3333-333333333333'
    const saved = await saveFolderImage(shopId, 'silom', 'hero', Buffer.from('img'), 'jpg')
    assert.match(saved.url, /\/hero\/[a-f0-9]+\.jpg$/)
    const listed = await listFolderImages(shopId, 'silom', 'hero')
    assert.equal(listed.files.length, 1)
    assert.equal(listed.files[0], saved.url)
  } finally {
    if (prev == null) delete process.env.UPLOAD_ROOT
    else process.env.UPLOAD_ROOT = prev
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('purgeShopUploadFiles removes booking-site dir', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nail-delete-site-'))
  const prev = process.env.UPLOAD_ROOT
  process.env.UPLOAD_ROOT = root
  try {
    const shopId = '44444444-4444-4444-4444-444444444444'
    const bookingSiteDir = path.join(root, 'booking-site', shopId, 'hero')
    await fs.mkdir(bookingSiteDir, { recursive: true })
    await fs.writeFile(path.join(bookingSiteDir, 'shot.jpg'), 'img')

    const refs = await collectShopFileRefs({
      query() { return Promise.resolve({ rows: [] }) },
    }, shopId)
    assert.match(refs.bookingSiteDir, new RegExp(`${shopId.replace(/-/g, '\\-')}$`))

    const summary = await purgeShopUploadFiles({
      shopId,
      bookingSlipFilenames: [],
      renewalSlipFilenames: [],
      uiDir: path.join(root, 'ui', shopId),
      chatDir: path.join(root, 'chat', shopId),
      bookingSiteDir: path.join(root, 'booking-site', shopId),
    })
    assert.equal(summary.booking_site_dir_removed, true)
    await assert.rejects(() => fs.access(path.join(bookingSiteDir, 'shot.jpg')))
  } finally {
    if (prev == null) delete process.env.UPLOAD_ROOT
    else process.env.UPLOAD_ROOT = prev
    await fs.rm(root, { recursive: true, force: true })
  }
})
