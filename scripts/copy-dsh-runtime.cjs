const fs = require('node:fs')
const path = require('node:path')

// Keep runtime TypeScript, arbitrary .map assets, documentation and licenses.
// Only compiler declarations and JS/TS source maps are development metadata.
const buildMetadata = /(?:\.d\.(?:ts|mts|cts)|\.(?:js|mjs|cjs|jsx|ts|mts|cts|tsx)\.map)$/i

function copyRuntimeDependencies(source, target) {
  const omitted = { files: 0, bytes: 0 }
  fs.cpSync(source, target, {
    recursive: true,
    dereference: true,
    filter(file) {
      if (!buildMetadata.test(path.basename(file))) return true
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
