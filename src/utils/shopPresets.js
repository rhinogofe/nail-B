const { setShopSetting } = require('./shopSettings')
const { getUiSettings, setUiSettings, UI_DEFAULTS } = require('./shopUiSettings')
const { buildDefaultContent, CONTENT_KEY } = require('./bookingSite')

const MAX_REGISTER_SERVICES = 40

const SHOP_PRESETS = [
  {
    key: 'nails',
    label: 'ร้านทำเล็บ',
    hint: 'ทาสีเจล เติมเล็บ สปามือ-เท้า',
    icon: 'ti-palette',
    tagline: 'จองคิวง่าย · เล็บสวยทุกครั้ง',
    categories: [
      {
        name: 'มือ',
        services: [
          { option_name: 'ทาสีเจลมือ', description: 'ทำความสะอาดเล็บ ตัดหนัง และทาสีเจล', price: 450, duration_min: 60 },
          { option_name: 'เติมเล็บเจล', description: 'เติมความยาว จัดทรง และทาสีเจล', price: 650, duration_min: 90 },
        ],
      },
      {
        name: 'เท้า',
        services: [
          { option_name: 'ทาสีเจลเท้า', description: 'ทำความสะอาดเล็บเท้า และทาสีเจล', price: 550, duration_min: 75 },
          { option_name: 'สปาเท้า', description: 'แช่เท้า นวด และบำรุงผิว', price: 350, duration_min: 45 },
        ],
      },
    ],
    site: {
      roomsHeading: 'บริการทำเล็บ',
      hero: [
        { tab: 'หน้าแรก', title: 'เล็บสวยแบบจองคิวได้', text: 'ทาสีเจล เติมเล็บ และสปา ที่จัดคิวให้เรียบร้อยก่อนคุณมา' },
        { tab: 'บริการ', title: 'เลือกคิวทำเล็บได้เลย', text: 'ทาสีเจล เติมเล็บ สปามือ-เท้า จองเวลาล่วงหน้าได้' },
        { tab: 'โปรโมชั่น', title: 'จองวันนี้ ดูแลเล็บ', text: 'โปรโมชั่นพิเศษสำหรับการจองโดยตรงกับร้าน' },
        { tab: 'รีวิว', title: 'ผลงานจากลูกค้าที่จองคิว', text: 'ดูรีวิวและรูปผลงานก่อนจอง' },
      ],
    },
  },
  {
    key: 'hair',
    label: 'ร้านตัดผม',
    hint: 'ตัด สระไดร์ ทำสี',
    icon: 'ti-scissors',
    tagline: 'จองคิวง่าย · ตัดผมตรงเวลา',
    categories: [
      {
        name: 'ตัดผม',
        services: [
          { option_name: 'ตัดผมชาย', description: 'ตัด จัดทรง ตามสไตล์ที่ต้องการ', price: 250, duration_min: 45 },
          { option_name: 'ตัดผมหญิง', description: 'ตัด ซอย จัดทรง', price: 400, duration_min: 60 },
        ],
      },
      {
        name: 'ทำสี & สระ',
        services: [
          { option_name: 'สระไดร์', description: 'สระ ไดร์ และจัดทรง', price: 350, duration_min: 45 },
          { option_name: 'ทำสีผม', description: 'ปิดขาว หรือเปลี่ยนสีตามที่ปรึกษา', price: 1500, duration_min: 120 },
        ],
      },
    ],
    site: {
      roomsHeading: 'บริการร้านผม',
      hero: [
        { tab: 'หน้าแรก', title: 'ตัดผมตรงเวลาที่จอง', text: 'เลือกคิวตัด สระไดร์ หรือทำสี แล้วมาตามนัด' },
        { tab: 'บริการ', title: 'เลือกคิวตัด สระ ทำสี', text: 'ไม่ต้องเดินมาจองคิวหน้าเคาน์เตอร์' },
        { tab: 'โปรโมชั่น', title: 'จองคิวตัดผมวันนี้', text: 'โปรโมชั่นพิเศษสำหรับการจองโดยตรงกับร้าน' },
        { tab: 'รีวิว', title: 'ผลงานจากลูกค้าที่จองคิว', text: 'ดูรีวิวและรูปผลงานก่อนจอง' },
      ],
    },
  },
  {
    key: 'lashes',
    label: 'ร้านต่อขนตา',
    hint: 'คลาสสิก วอลลุม เติมขนตา',
    icon: 'ti-eye',
    tagline: 'จองคิวง่าย · ขนตางอนธรรมชาติ',
    categories: [
      {
        name: 'ต่อขนตา',
        services: [
          { option_name: 'ต่อขนตาคลาสสิก', description: 'ต่อแบบธรรมชาติ เส้นต่อเส้น', price: 990, duration_min: 90 },
          { option_name: 'ต่อขนตาวอลลุม', description: 'เพิ่มความหนา ดูมีมิติ', price: 1500, duration_min: 120 },
        ],
      },
      {
        name: 'เติม & ล้าง',
        services: [
          { option_name: 'เติมขนตา', description: 'เติมช่วงที่หลุด ยืดอายุเซ็ตเดิม', price: 690, duration_min: 60 },
          { option_name: 'ล้างขนตา', description: 'ถอดขนตาอย่างปลอดภัย ทำความสะอาดโคนขน', price: 250, duration_min: 30 },
        ],
      },
    ],
    site: {
      roomsHeading: 'บริการต่อขนตา',
      hero: [
        { tab: 'หน้าแรก', title: 'ขนตางอน ตรงเวลาที่จอง', text: 'เลือกแบบคลาสสิกหรือวอลลุม แล้วมาตามนัด' },
        { tab: 'บริการ', title: 'เลือกคิวต่อขนตา', text: 'คิวเป็นระเบียบ ช่างได้เวลาทำจริง' },
        { tab: 'โปรโมชั่น', title: 'จองต่อขนตาวันนี้', text: 'โปรโมชั่นพิเศษสำหรับการจองโดยตรงกับร้าน' },
        { tab: 'รีวิว', title: 'ผลงานจากลูกค้าที่จองคิว', text: 'ดูรีวิวและรูปผลงานก่อนจอง' },
      ],
    },
  },
  {
    key: 'brows',
    label: 'ร้านคิ้ว / สักคิ้ว',
    hint: 'กรีดคิ้ว ย้อม สักนาโน ลิฟติ้ง',
    icon: 'ti-mood-smile',
    tagline: 'จองคิวง่าย · คิ้วทรงสวย',
    categories: [
      {
        name: 'ดูแลคิ้ว',
        services: [
          { option_name: 'กรีดคิ้ว', description: 'จัดทรงคิ้วให้เข้าหน้า', price: 350, duration_min: 30 },
          { option_name: 'ย้อมคิ้ว', description: 'เติมสีคิ้วให้ออกมาชัด', price: 450, duration_min: 45 },
        ],
      },
      {
        name: 'สัก & ลิฟติ้ง',
        services: [
          { option_name: 'สักคิ้วนาโน', description: 'สักเส้นธรรมชาติ อยู่ได้นาน', price: 3500, duration_min: 150 },
          { option_name: 'ลิฟติ้งคิ้ว', description: 'ยกโคนคิ้วให้อยู่ทรง', price: 890, duration_min: 60 },
        ],
      },
    ],
    site: {
      roomsHeading: 'บริการคิ้ว',
      hero: [
        { tab: 'หน้าแรก', title: 'คิ้วทรงสวย ตรงนัด', text: 'เลือกกรีด ย้อม สัก หรือลิฟติ้ง แล้วจองเวลาได้เลย' },
        { tab: 'บริการ', title: 'เลือกคิวกรีด ย้อม สักคิ้ว', text: 'คิวชัด ช่างมีเวลาออกแบบทรงให้เข้าหน้า' },
        { tab: 'โปรโมชั่น', title: 'จองคิ้ววันนี้', text: 'โปรโมชั่นพิเศษสำหรับการจองโดยตรงกับร้าน' },
        { tab: 'รีวิว', title: 'ผลงานจากลูกค้าที่จองคิว', text: 'ดูรีวิวและรูปผลงานก่อนจอง' },
      ],
    },
  },
  {
    key: 'spa',
    label: 'ร้านสปา / นวด',
    hint: 'นวดไทย อโรมา สปาหน้า',
    icon: 'ti-leaf',
    tagline: 'จองคิวง่าย · พักผ่อนได้จริง',
    categories: [
      {
        name: 'นวด',
        services: [
          { option_name: 'นวดไทย 60 นาที', description: 'นวดคลายกล้ามเนื้อทั้งตัว', price: 450, duration_min: 60 },
          { option_name: 'นวดอโรมา 90 นาที', description: 'นวดน้ำมันหอมระเหย ผ่อนคลาย', price: 790, duration_min: 90 },
        ],
      },
      {
        name: 'สปา',
        services: [
          { option_name: 'สปาหน้า', description: 'ทำความสะอาดผิวและบำรุง', price: 1200, duration_min: 75 },
          { option_name: 'นวดเท้า', description: 'แช่เท้าและนวดฝ่าเท้า', price: 350, duration_min: 45 },
        ],
      },
    ],
    site: {
      roomsHeading: 'คอร์สนวด & สปา',
      hero: [
        { tab: 'หน้าแรก', title: 'พักผ่อนตามเวลาที่จอง', text: 'เลือกคอร์สนวดหรือสปา แล้วมาตรงนัด' },
        { tab: 'บริการ', title: 'เลือกคอร์สนวดและสปา', text: 'จองล่วงหน้า ร้านจัดคิวให้ไม่ซ้อนกัน' },
        { tab: 'โปรโมชั่น', title: 'จองสปาวันนี้', text: 'โปรโมชั่นพิเศษสำหรับการจองโดยตรงกับร้าน' },
        { tab: 'รีวิว', title: 'รีวิวจากลูกค้าที่จองคิว', text: 'ดูรีวิวก่อนจอง นัดหมายได้ตามเวลาที่สะดวก' },
      ],
    },
  },
]

function summarizePreset(preset) {
  return {
    key: preset.key,
    label: preset.label,
    hint: preset.hint,
    icon: preset.icon,
    tagline: preset.tagline,
    categories: (preset.categories || []).map((cat) => ({
      name: cat.name,
      services: (cat.services || []).map((svc) => ({ ...svc })),
    })),
  }
}

function listShopPresets() {
  return SHOP_PRESETS.map(summarizePreset)
}

function getShopPreset(key) {
  const k = String(key || '').trim().toLowerCase()
  if (!k) return null
  return SHOP_PRESETS.find((preset) => preset.key === k) || null
}

function flattenPresetServices(preset) {
  const list = []
  for (const cat of preset?.categories || []) {
    for (const svc of cat.services || []) {
      list.push({
        option_name: svc.option_name,
        description: svc.description || null,
        price: svc.price,
        duration_min: svc.duration_min,
        is_active: true,
        is_required: false,
        category_name: cat.name,
      })
    }
  }
  return list
}

function normalizeRegisterServices(raw, { max = MAX_REGISTER_SERVICES } = {}) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const option_name = String(item.option_name || item.name || '').trim().slice(0, 120)
    if (!option_name) continue
    const price = Number(item.price)
    const duration_min = Number(item.duration_min ?? item.duration ?? 0)
    if (!Number.isFinite(price) || price < 0) continue
    if (!Number.isFinite(duration_min) || duration_min < 0) continue
    const category_name = String(item.category_name || item.category || '').trim().slice(0, 80)
    out.push({
      option_name,
      description: String(item.description || '').trim().slice(0, 500) || null,
      price: Math.round(price),
      duration_min: Math.round(duration_min),
      is_active: item.is_active === false ? false : true,
      is_required: Boolean(item.is_required),
      category_name,
    })
    if (out.length >= max) break
  }
  return out
}

function planPresetSeed(preset, incoming) {
  if (Array.isArray(incoming) && incoming.length) {
    const groups = new Map()
    const fallbackName = preset?.categories?.[0]?.name || 'บริการ'
    for (const svc of incoming) {
      const catName = svc.category_name || fallbackName
      if (!groups.has(catName)) groups.set(catName, [])
      groups.get(catName).push(svc)
    }
    return {
      categories: [...groups.entries()].map(([name, services]) => ({ name, services })),
    }
  }

  return {
    categories: (preset?.categories || []).map((cat) => ({
      name: cat.name,
      services: (cat.services || []).map((svc) => ({
        option_name: svc.option_name,
        description: svc.description || null,
        price: svc.price,
        duration_min: svc.duration_min,
        is_active: true,
        is_required: false,
        category_name: cat.name,
      })),
    })),
  }
}

function roomsFromSeed(seed) {
  const types = ['classic', 'signature', 'spa-hands']
  const rooms = []
  for (const cat of seed?.categories || []) {
    for (const svc of cat.services || []) {
      const bits = [
        svc.description,
        Number(svc.duration_min) > 0 ? `${svc.duration_min} นาที` : '',
      ].filter(Boolean)
      rooms.push({
        name: svc.option_name,
        detail: bits.join(' · '),
        showImage: true,
        image: '',
        link: '',
        type: types[rooms.length % types.length],
      })
      if (rooms.length >= 6) return rooms
    }
  }
  return rooms
}

function overlayPresetSite(content, preset, rooms) {
  const next = JSON.parse(JSON.stringify(content || {}))
  const site = preset?.site || {}
  if (site.roomsHeading) next.roomsHeading = site.roomsHeading
  if (site.about && typeof site.about === 'object') {
    next.about = { ...(next.about || {}), ...site.about }
  }
  if (Array.isArray(site.hero) && site.hero.length && Array.isArray(next.hero)) {
    next.hero = next.hero.map((slide, i) => {
      const patch = site.hero[i] || null
      if (!patch) return slide
      return {
        ...slide,
        tab: patch.tab || slide.tab,
        title: patch.title || slide.title,
        text: patch.text || slide.text,
        button: patch.button || slide.button,
      }
    })
  }
  if (Array.isArray(rooms) && rooms.length) {
    next.rooms = rooms
  } else if (Array.isArray(site.rooms) && site.rooms.length) {
    next.rooms = site.rooms.map((room) => ({
      showImage: true,
      image: '',
      link: '',
      type: 'classic',
      ...room,
    }))
  }
  return next
}

async function seedShopServices(client, shopId, seed) {
  let sortOrder = 1
  let seeded = 0
  for (let ci = 0; ci < seed.categories.length; ci += 1) {
    const cat = seed.categories[ci]
    const catName = String(cat.name || '').trim() || 'บริการ'
    const catRes = await client.query(
      `INSERT INTO service_categories (shop_id, name, sort_order, is_active)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (shop_id, name)
       DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [shopId, catName, ci],
    )
    const categoryId = catRes.rows[0].id
    for (const svc of cat.services || []) {
      await client.query(
        `INSERT INTO nailoption (
          shop_id, option_name, description, price, duration_min,
          is_active, is_required, sort_order, category_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          shopId,
          svc.option_name,
          svc.description,
          svc.price,
          svc.duration_min,
          svc.is_active !== false,
          Boolean(svc.is_required),
          sortOrder,
          categoryId,
        ],
      )
      sortOrder += 1
      seeded += 1
    }
  }
  return seeded
}

async function applyShopPreset(client, shop, { presetKey, services } = {}) {
  const key = String(presetKey || '').trim().toLowerCase()
  const preset = key ? getShopPreset(key) : null
  if (key && !preset) {
    const err = new Error('ไม่พบเทมเพลตร้านนี้')
    err.status = 400
    throw err
  }

  const incoming = normalizeRegisterServices(services)
  if (!preset && !incoming.length) {
    return { preset: null, seeded: 0 }
  }

  const seed = planPresetSeed(preset, incoming)
  const seeded = await seedShopServices(client, shop.id, seed)

  if (preset) {
    const content = overlayPresetSite(
      buildDefaultContent(shop),
      preset,
      roomsFromSeed(seed),
    )
    await setShopSetting(client, shop.id, CONTENT_KEY, JSON.stringify(content))

    if (preset.tagline) {
      const ui = await getUiSettings(client, shop.id)
      const current = String(ui.ui_tagline || '').trim()
      if (!current || current === UI_DEFAULTS.ui_tagline) {
        await setUiSettings(client, shop.id, { ui_tagline: preset.tagline })
      }
    }
  }

  return { preset: preset?.key || null, seeded }
}

module.exports = {
  SHOP_PRESETS,
  MAX_REGISTER_SERVICES,
  listShopPresets,
  getShopPreset,
  flattenPresetServices,
  normalizeRegisterServices,
  planPresetSeed,
  roomsFromSeed,
  overlayPresetSite,
  applyShopPreset,
}
