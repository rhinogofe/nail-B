const fs = require('fs').promises
const path = require('path')

const DEFAULT_UPLOAD_ROOT = path.join(__dirname, '../../uploads')

function getUploadRoot() {
  const configured = String(process.env.UPLOAD_ROOT || '').trim()
  return configured ? path.resolve(configured) : DEFAULT_UPLOAD_ROOT
}

function getUiUploadRoot() {
  return path.join(getUploadRoot(), 'ui')
}

function getChatUploadRoot() {
  return path.join(getUploadRoot(), 'chat')
}

async function ensureUploadDirs() {
  await fs.mkdir(getUiUploadRoot(), { recursive: true })
  await fs.mkdir(getChatUploadRoot(), { recursive: true })
}

module.exports = {
  getUploadRoot,
  getUiUploadRoot,
  getChatUploadRoot,
  ensureUploadDirs,
}
