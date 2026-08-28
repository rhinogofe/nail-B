const test = require('node:test')
const assert = require('node:assert/strict')

function mockReq({ protocol = 'http', host = 'nail-b.onrender.com', forwardedProto } = {}) {
  return {
    protocol,
    get(name) {
      if (name === 'host') return host
      if (name === 'x-forwarded-proto') return forwardedProto
      return undefined
    },
  }
}

test('resolvePublicApiBase upgrades http behind proxy to https', () => {
  const { resolvePublicApiBase } = require('../src/utils/publicApiBase')
  assert.equal(
    resolvePublicApiBase(mockReq({ protocol: 'http', host: 'nail-b.onrender.com' })),
    'https://nail-b.onrender.com',
  )
})

test('resolvePublicApiBase keeps localhost on http', () => {
  const { resolvePublicApiBase } = require('../src/utils/publicApiBase')
  assert.equal(
    resolvePublicApiBase(mockReq({ protocol: 'http', host: 'localhost:3000' })),
    'http://localhost:3000',
  )
})

test('resolvePublicApiBase prefers API_PUBLIC_URL', () => {
  const { resolvePublicApiBase } = require('../src/utils/publicApiBase')
  const prev = process.env.API_PUBLIC_URL
  process.env.API_PUBLIC_URL = 'https://api.example.com/'
  try {
    assert.equal(
      resolvePublicApiBase(mockReq({ protocol: 'http', host: 'ignored.test' })),
      'https://api.example.com',
    )
  } finally {
    if (prev == null) delete process.env.API_PUBLIC_URL
    else process.env.API_PUBLIC_URL = prev
  }
})
