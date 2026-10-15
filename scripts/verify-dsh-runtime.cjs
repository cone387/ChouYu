const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')

function verifyRuntime(root) {
  const base = path.resolve(root)
  const manifest = JSON.parse(fs.readFileSync(path.join(base, 'manifest.json'), 'utf8'))
  for (const file of manifest.files) {
    const target = path.resolve(base, file.path)
    if (!target.startsWith(base + path.sep)) throw new Error('DSH manifest path escapes runtime')
    const stat = fs.statSync(target)
    if (!stat.isFile() || stat.size !== file.bytes) throw new Error(`DSH packaged resource mismatch: ${file.path}`)
  }
  const node = path.join(base, 'node.exe')
  if (crypto.createHash('sha256').update(fs.readFileSync(node)).digest('hex') !== manifest.nodeExecutableSha256) {
    throw new Error('DSH packaged Node checksum mismatch')
  }
  execFileSync(node, ['--input-type=module', '-e', "await import('@deepseek-ai/dsh-sdk-client'); console.log('DSH_PACKAGED_IMPORT_OK')"], {
    cwd: base, windowsHide: true, timeout: 15000, stdio: 'pipe'
  })
  console.log(`DSH packaged closure verified: ${manifest.files.length} files`)
}

module.exports = async context => {
  if (context.electronPlatformName === 'win32') verifyRuntime(path.join(context.appOutDir, 'resources', 'dsh-runtime'))
}
module.exports.verifyRuntime = verifyRuntime
