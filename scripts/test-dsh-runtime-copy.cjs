const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { copyRuntimeDependencies } = require('./copy-dsh-runtime.cjs')

test('copied dependencies run with resources and licenses but omit build-only metadata', () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'chouyu-runtime-copy-'))
  try {
    const source = path.join(work, 'source')
    const target = path.join(work, 'target')
    const files = {
      'package.json': '{"type":"module"}',
      'index.js': "import fs from 'node:fs'; console.log(fs.readFileSync(new URL('./assets/schema.json', import.meta.url), 'utf8'))",
      'assets/schema.json': '{"working":true}',
      'assets/help.md': 'Runtime help',
      'LICENSE': 'Required license',
      'source.ts': 'export const runtimeTypeScript = true',
      'index.d.ts': 'export declare const value: string',
      'index.d.mts': 'export declare const value: string',
      'index.d.cts': 'export declare const value: string',
      'index.js.map': '{}',
      'assets/world.map': 'Runtime resource, not a source map',
      'nested/node_modules/dep/index.cjs': 'module.exports = 42',
      'nested/node_modules/dep/index.cjs.map': '{}',
      'nested/node_modules/dep/index.d.ts.map': '{}'
    }
    for (const [name, contents] of Object.entries(files)) {
      const file = path.join(source, name)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, contents)
    }
    copyRuntimeDependencies(source, target)
    assert.equal(execFileSync(process.execPath, [path.join(target, 'index.js')], { encoding: 'utf8' }).trim(), '{"working":true}')
    for (const name of ['assets/help.md', 'LICENSE', 'source.ts', 'assets/world.map', 'nested/node_modules/dep/index.cjs']) {
      assert.equal(fs.readFileSync(path.join(target, name), 'utf8'), files[name])
    }
    for (const name of ['index.d.ts', 'index.d.mts', 'index.d.cts', 'index.js.map', 'nested/node_modules/dep/index.cjs.map', 'nested/node_modules/dep/index.d.ts.map']) {
      assert.equal(fs.existsSync(path.join(target, name)), false, `${name} should not ship`)
      assert.equal(fs.readFileSync(path.join(source, name), 'utf8'), files[name], 'development dependency must remain intact')
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
})
