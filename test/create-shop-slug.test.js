const test = require('node:test')
const assert = require('node:assert/strict')
const {
  slugifyShopName,
  isCreatableShopSlug,
  isShopSlugFormat,
} = require('../src/utils/shopSlug')

test('slugify keeps Thai letters and numbers from the shop name', () => {
  assert.equal(slugifyShopName('กอฟเทส1'), 'กอฟเทส1')
  assert.equal(slugifyShopName('กอฟเทส 1!'), 'กอฟเทส-1')
  assert.equal(slugifyShopName('Nail Studio'), 'nail-studio')
  assert.equal(slugifyShopName('  Nail   Studio!!  '), 'nail-studio')
})

test('slugify strips punctuation but keeps hyphens between words', () => {
  assert.equal(slugifyShopName('ร้านเล็บ (สาขา 2)'), 'ร้านเล็บ-สาขา-2')
})

test('creatable slugs reject reserved and empty values', () => {
  assert.equal(isCreatableShopSlug('กอฟเทส1'), true)
  assert.equal(isCreatableShopSlug('nail-studio'), true)
  assert.equal(isCreatableShopSlug('default'), false)
  assert.equal(isCreatableShopSlug('admin'), false)
  assert.equal(isCreatableShopSlug(''), false)
  assert.equal(isShopSlugFormat('default'), true)
})
