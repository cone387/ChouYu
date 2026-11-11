const fs = require('node:fs')
const path = require('node:path')

// Keep runtime TypeScript, arbitrary .map assets, documentation and licenses.
// Only compiler declarations and JS/TS source maps are development metadata.
const buildMetadata = /(?:\.d\.(?:ts|mts|cts)|\.(?:js|mjs|cjs|jsx|ts|mts|cts|tsx)\.map)$/i
// This runtime is built exclusively for Windows x64. node-pty ships other
// platforms in the same npm package; its loader selects only win32-x64 here.
const foreignPty = /(?:^|\/)node-pty\/(?:prebuilds\/(?!win32-x64(?:\/|$))[^/]+\/|third_party\/conpty\/[^/]+\/win10-arm64\/)/

function copyRuntimeDependencies(source, target) {
  const omitted = { files: 0, bytes: 0 }
  fs.cpSync(source, target, {
    recursive: true,
    dereference: true,
    filter(file) {
      const relative = path.relative(source, file).replaceAll('\\', '/')
      if (!buildMetadata.test(path.basename(file)) && !foreignPty.test(relative)) return true
      const stat = fs.statSync(file)
      if (!stat.isFile()) return true
      omitted.files++
      omitted.bytes += stat.size
      return false
    }
  })
  return omitted
}

module.exports = { copyRuntimeDependencies }
