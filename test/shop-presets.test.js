const test = require('node:test')
const assert = require('node:assert/strict')
const {
  SHOP_PRESETS,
  listShopPresets,
  getShopPreset,
  flattenPresetServices,
  normalizeRegisterServices,
  planPresetSeed,
  roomsFromSeed,
  overlayPresetSite,
  applyShopPreset,
} = require('../src/utils/shopPresets')

test('catalog has five shop type presets', () => {
  const keys = SHOP_PRESETS.map((p) => p.key)
  assert.deepEqual(keys, ['nails', 'hair', 'lashes', 'brows', 'spa'])
  assert.equal(listShopPresets().length, 5)
})

test('each preset has starter categories and services', () => {
  for (const preset of SHOP_PRESETS) {
    const services = flattenPresetServices(preset)
    assert.ok(preset.label)
    assert.ok(preset.hint)
    assert.ok(preset.icon)
    assert.ok(preset.categories.length >= 2)
    assert.ok(services.length >= 4)
    assert.ok(services.every((svc) => svc.option_name && svc.category_name))
  }
})

test('getShopPreset finds and rejects keys', () => {
  assert.equal(getShopPreset('nails').label, 'ร้านทำเล็บ')
  assert.equal(getShopPreset('HAIR').key, 'hair')
  assert.equal(getShopPreset('unknown'), null)
  assert.equal(getShopPreset(''), null)
})

test('normalizeRegisterServices drops invalid rows', () => {
  const rows = normalizeRegisterServices([
    { option_name: 'ทาสีเจลมือ', price: 450, duration_min: 60, category_name: 'มือ' },
    { option_name: '  ', price: 10, duration_min: 10 },
    { option_name: 'ลบไม่ได้', price: -1, duration_min: 10 },
    { name: 'สปาเท้า', price: '350', duration: 45, category: 'เท้า' },
  ])
  assert.equal(rows.length, 2)
  assert.equal(rows[0].option_name, 'ทาสีเจลมือ')
  assert.equal(rows[1].option_name, 'สปาเท้า')
  assert.equal(rows[1].category_name, 'เท้า')
  assert.equal(rows[1].duration_min, 45)
})

test('planPresetSeed uses incoming services and keeps categories', () => {
  const preset = getShopPreset('nails')
  const seed = planPresetSeed(preset, [
    { option_name: 'เจลมือพิเศษ', price: 700, duration_min: 70, category_name: 'มือ' },
    { option_name: 'เจลเท้า', price: 500, duration_min: 50, category_name: 'เท้า' },
  ])
  assert.deepEqual(seed.categories.map((c) => c.name), ['มือ', 'เท้า'])
  assert.equal(seed.categories[0].services[0].option_name, 'เจลมือพิเศษ')
})

test('planPresetSeed falls back to preset services', () => {
  const preset = getShopPreset('hair')
  const seed = planPresetSeed(preset, [])
  assert.ok(seed.categories.length >= 2)
  assert.equal(
    seed.categories.reduce((n, cat) => n + cat.services.length, 0),
    flattenPresetServices(preset).length,
  )
})

test('overlayPresetSite applies copy and rooms from seed', () => {
  const preset = getShopPreset('lashes')
  const seed = planPresetSeed(preset, [])
  const content = overlayPresetSite(
    {
      roomsHeading: 'บริการ',
      about: { title: 'เดิม', text: 'เดิม', showImage: true, image: '' },
      hero: [
        { tab: 'บริการ', title: 'old', text: 'old', button: 'จองคิว' },
        { tab: 'บรรยากาศ', title: 'old', text: 'old', button: 'จองคิว' },
      ],
      rooms: [],
    },
    preset,
    roomsFromSeed(seed),
  )
  assert.equal(content.roomsHeading, 'บริการต่อขนตา')
  assert.equal(content.about.title, 'เดิม')
  assert.match(content.hero[0].title, /ขนตา/)
  assert.ok(content.rooms.length >= 4)
  assert.equal(content.rooms[0].name, 'ต่อขนตาคลาสสิก')
})

test('applyShopPreset rejects unknown keys without querying', async () => {
  await assert.rejects(
    () => applyShopPreset({}, { id: 'shop-1' }, { presetKey: 'not-a-shop' }),
    (err) => err.status === 400 && /ไม่พบเทมเพลต/.test(err.message),
  )
})
