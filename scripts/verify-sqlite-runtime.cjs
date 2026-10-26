// node scripts/verify-sqlite-runtime.cjs <packaged executable> <app.asar>
const assert = require('node:assert/strict')
const { createRequire } = require('node:module')
const { mkdtempSync, readdirSync, unlinkSync, rmdirSync, existsSync } = require('node:fs')
const { join, resolve, dirname, relative, isAbsolute, sep } = require('node:path')
const { tmpdir } = require('node:os')
const { spawnSync } = require('node:child_process')
const passed = 'Packaged SQLite checkpoint persistence passed:'

async function main() {
  assert.ok(process.versions.electron, 'Use the packaged Electron runtime')
  assert.ok(process.argv[2], 'Provide the application directory or app.asar')
  const appRoot = resolve(process.argv[2])
  const contained = file => {
    const path = relative(appRoot, file)
    assert.ok(path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path), `Dependency escaped packaged app: ${file}`)
    return file
  }
  const appRequire = createRequire(join(appRoot, 'package.json'))
  const checkpointRequire = createRequire(contained(appRequire.resolve('@langchain/langgraph-checkpoint-sqlite')))
  contained(appRequire.resolve('@langchain/langgraph'))
  assert.equal(contained(checkpointRequire.resolve('better-sqlite3')), contained(appRequire.resolve('better-sqlite3')))
  if (process.platform === 'darwin') {
    const root = dirname(appRequire.resolve('better-sqlite3/package.json'))
    for (const arch of ['x64', 'arm64']) assert.ok(existsSync(join(root, 'prebuilds', `darwin-${arch}.node`)), `Missing ${arch} SQLite binding`)
  }
  const { SqliteSaver } = appRequire('@langchain/langgraph-checkpoint-sqlite')
  const { Annotation, StateGraph, START, END } = appRequire('@langchain/langgraph')
  const home = mkdtempSync(join(tmpdir(), 'chouyu-sqlite-probe-'))
  let saver
  try {
    const file = join(home, 'checkpoints.db')
    saver = SqliteSaver.fromConnString(file)
    const state = Annotation.Root({ value: Annotation() })
    const graph = new StateGraph(state).addNode('write', () => ({ value: 'persisted' }))
      .addEdge(START, 'write').addEdge('write', END).compile({ checkpointer: saver })
    const config = { configurable: { thread_id: 'packaged-native-binding' } }
    await graph.invoke({}, { ...config, durability: 'sync' })
    saver.db.close()
    saver = SqliteSaver.fromConnString(file)
    assert.equal((await saver.getTuple(config)).checkpoint.channel_values.value, 'persisted')
    console.log(`${passed} ${process.platform}/${process.arch}, Electron ${process.versions.electron}`)
  } finally {
    if (saver?.db.open) saver.db.close()
    for (const file of readdirSync(home)) unlinkSync(join(home, file))
    rmdirSync(home)
  }
}
if (process.versions.electron) main().catch(error => { console.error(error); process.exitCode = 1 })
else {
  assert.ok(process.argv[2] && process.argv[3], 'Provide the packaged executable and application directory')
  const result = spawnSync(resolve(process.argv[2]), [__filename, resolve(process.argv[3])], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', windowsHide: true, timeout: 30000
  })
  process.stdout.write(result.stdout || '')
  process.stderr.write(result.stderr || '')
  assert.ifError(result.error)
  assert.equal(result.status, 0, 'Packaged SQLite probe failed')
  assert.ok(result.stdout.includes(passed), 'Packaged SQLite probe did not report completion')
}
