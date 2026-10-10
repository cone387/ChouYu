import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { SkillLibrary } from './library'
import { SkillRunner, containerArguments } from './runner'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
// Explicit opt-in because this downloads the runtime image and uses a real Docker engine.
it.skipIf(process.env.CHOUYU_TEST_DOCKER !== '1')('runs Node, Python and Bash, imports output, and kills timed-out containers', async () => {
  const root = mkdtempSync(join(tmpdir(), 'chouyu-docker-')); roots.push(root)
  const source = join(root, 'source'); mkdirSync(source)
  writeFileSync(join(source, 'SKILL.md'), '---\nname: Runtime integration\n---\nRun the bundled test scripts.')
  writeFileSync(join(source, 'node.cjs'), 'require("node:fs").writeFileSync("node.txt", "node passed"); console.log("node output")')
  writeFileSync(join(source, 'python.py'), 'open("python.txt", "w").write("python passed")\nprint("python output")')
  writeFileSync(join(source, 'shell.sh'), 'printf "shell passed" > shell.txt\nprintf "shell output"')
  writeFileSync(join(source, 'timeout.cjs'), 'setInterval(() => {}, 1000)')
  writeFileSync(join(source, 'cancel.cjs'), 'console.log("cancellation fixture ready");setInterval(() => {}, 1000)')
  writeFileSync(join(source, 'bounds.cjs'), 'const fs=require("node:fs"); for(const p of ["/inputwork/no.txt","/skill/no.txt","/root/no.txt"]){let blocked=false;try{fs.writeFileSync(p,"bad")}catch{blocked=true}if(!blocked)throw Error("writable "+p)}; console.log("boundaries passed")')
  writeFileSync(join(source, 'network.cjs'), 'if(Object.keys(require("node:os").networkInterfaces()).some(name=>name!=="lo"))throw Error("unexpected network interface");if(process.env.OPENAI_API_KEY)throw Error("host credential leaked");console.log("offline passed")')
  const library = new SkillLibrary(join(root, 'library')); library.publish('runtime', source); library.configure('alice', 'runtime', 'enable_scripts', 0)
  const runner = new SkillRunner(library), signal = new AbortController().signal
  const status = await runner.status(); expect(status.engineReady, status.message).toBe(true)
  if (!status.ready) expect((await runner.prepare(signal)).ready).toBe(true)
  const snapshot = library.snapshot('alice')
  for (const script of ['node.cjs', 'python.py', 'shell.sh', 'bounds.cjs', 'network.cjs']) await runner.run('alice', snapshot, 'runtime', script, [], signal)
  for (const runtime of ['node', 'python', 'shell']) expect(runner.readFile('alice', snapshot, 'runtime', `${runtime}.txt`, 'workspace')).toBe(`${runtime} passed`)
  await expect(runner.run('alice', snapshot, 'runtime', 'timeout.cjs', [], signal, 1000)).rejects.toThrow()
  expect(runner.logs('alice')[0].status).toBe('cancelled')
  expect(runner.logs('alice')[0].cleanupPending).toBe(false)
  const cancellation = new AbortController()
  const running = runner.run('alice', snapshot, 'runtime', 'cancel.cjs', [], cancellation.signal)
  const cancelled = expect(running).rejects.toThrow()
  try {
    // Wait for output from the actual process, not merely a queued operation record.
    await vi.waitFor(() => expect(runner.logs('alice')[0].output).toContain('cancellation fixture ready'), { timeout: 30000, interval: 100 })
  } finally { cancellation.abort(); await cancelled }
  expect(runner.logs('alice')[0].status).toBe('cancelled')
  expect(runner.logs('alice')[0].cleanupPending).toBe(false)
  // Leave a real container behind after its recorded owner exits, then use the
  // production recovery path to remove it and mark the persisted run interrupted.
  const orphanId = randomUUID(), orphanName = `chouyu-skill-${randomUUID()}`
  const exitedPid = Number(execFileSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8', windowsHide: true }))
  const orphanArgs = containerArguments(orphanName, 'chouyu-skill-runtime:2', library.packageDirectory('runtime', snapshot.entries[0].digest), runner.workspace('alice', 'runtime'), 'node', 'cancel.cjs', [])
  try {
    execFileSync('docker', [orphanArgs[0], '--detach', ...orphanArgs.slice(1)], { windowsHide: true, stdio: 'pipe' })
    writeFileSync(join(library.root, 'runtime', 'logs', `${orphanId}.json`), JSON.stringify({ id: orphanId, characterId: 'alice', skillId: 'runtime', kind: 'script', startedAt: Date.now(), status: 'running', output: '', ownerPid: exitedPid, containerName: orphanName }))
    const recovered = new SkillRunner(library)
    await recovered.status()
    expect(recovered.logs('alice').find(log => log.id === orphanId)?.status).toBe('interrupted')
    expect(recovered.logs('alice').find(log => log.id === orphanId)?.cleanupPending).toBe(false)
    expect(() => execFileSync('docker', ['inspect', orphanName], { windowsHide: true, stdio: 'pipe' })).toThrow()
  } finally { try { execFileSync('docker', ['rm', '-f', orphanName], { windowsHide: true, stdio: 'pipe' }) } catch { /* already removed by recovery */ } }
}, 900000)

it.skipIf(process.env.CHOUYU_TEST_DOCKER !== '1')('downloads npm and Python dependencies and preserves installed command entry points', async () => {
  const root = mkdtempSync(join(tmpdir(), 'chouyu-dependencies-')); roots.push(root)
  const source = join(root, 'source'); mkdirSync(source)
  writeFileSync(join(source, 'SKILL.md'), '---\nname: Dependency integration\n---\nRun bundled dependency checks.')
  writeFileSync(join(source, 'package.json'), JSON.stringify({ private: true, dependencies: { semver: '7.6.3' }, scripts: { postinstall: 'node -e "require(\'node:fs\').writeFileSync(\'/skill/postinstall-ran\',\'unexpected\')"' } }))
  writeFileSync(join(source, 'requirements.txt'), 'six==1.16.0\n')
  writeFileSync(join(source, 'node.cjs'), 'const fs=require("node:fs");if(fs.existsSync("/skill/postinstall-ran"))throw Error("npm lifecycle script executed");const result=require("node:child_process").execFileSync("/skill/node_modules/.bin/semver",["1.2.3"],{encoding:"utf8"});fs.writeFileSync("npm.txt",result.trim());console.log(result)')
  writeFileSync(join(source, 'python.py'), 'import six\nopen("pip.txt", "w").write(six.__version__)\nprint(six.__version__)')
  const library = new SkillLibrary(join(root, 'library')); library.publish('dependencies', source); library.configure('alice', 'dependencies', 'enable_scripts', 0)
  const runner = new SkillRunner(library), signal = new AbortController().signal
  const status = await runner.status(); expect(status.engineReady, status.message).toBe(true)
  if (!status.ready) await runner.prepare(signal)
  await runner.prepareDependencies('alice', 'dependencies', signal)
  const snapshot = library.snapshot('alice')
  await runner.run('alice', snapshot, 'dependencies', 'node.cjs', [], signal)
  await runner.run('alice', snapshot, 'dependencies', 'python.py', [], signal)
  expect(runner.readFile('alice', snapshot, 'dependencies', 'npm.txt', 'workspace')).toBe('1.2.3')
  expect(runner.readFile('alice', snapshot, 'dependencies', 'pip.txt', 'workspace')).toBe('1.16.0')
}, 900000)
