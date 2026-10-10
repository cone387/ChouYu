import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync, renameSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SkillLibrary } from './library'
import { SkillRunner, scriptArguments, containerArguments } from './runner'
import { exportedFiles } from './container-worker'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'skill-runtime-')); roots.push(root)
  const source = join(root, 'source'); mkdirSync(source)
  writeFileSync(join(source, 'SKILL.md'), '---\nname: Script\n---\nWrite a note. Optional: scripts/run.js')
  mkdirSync(join(source, 'scripts')); writeFileSync(join(source, 'scripts/run.js'), 'console.log("hello")')
  const library = new SkillLibrary(join(root, 'library')); library.publish('script', source); library.configure('alice', 'script', 'enable', 0)
  return { root, library, runner: new SkillRunner(library), snapshot: library.snapshot('alice') }
}
it('keeps contact workspaces separate and rejects traversal and unassigned packages', () => {
  const { runner, snapshot } = setup()
  runner.writeFile('alice', snapshot, 'script', 'notes/design.md', 'hello')
  expect(runner.readFile('alice', snapshot, 'script', 'notes/design.md', 'workspace')).toBe('hello')
  expect(() => runner.readFile('bob', { entries: [], instruction: '' }, 'script', 'SKILL.md', 'package')).toThrow()
  expect(() => runner.writeFile('alice', snapshot, 'script', '../escape', 'bad')).toThrow()
  expect(() => runner.readFile('alice', snapshot, 'script', 'C:/secret', 'workspace')).toThrow()
})
it('rejects links created inside a workspace and validates argv without shell parsing', () => {
  const { root, runner, snapshot } = setup()
  const workspace = runner.workspace('alice', 'script')
  const outside = join(root, 'outside'); mkdirSync(outside)
  symlinkSync(outside, join(workspace, 'linked'), 'junction')
  expect(() => runner.writeFile('alice', snapshot, 'script', 'linked/file.txt', 'bad')).toThrow()
  rmSync(outside, { recursive: true })
  expect(() => runner.writeFile('alice', snapshot, 'script', 'linked/file.txt', 'bad')).toThrow()
  expect(scriptArguments('["a; rm -rf /", "hello world"]')).toEqual(['a; rm -rf /', 'hello world'])
  expect(() => scriptArguments('{"bad":true}')).toThrow()
})
it('builds an isolated container with no host credentials, network, shell interpolation or broad mounts', () => {
  const args = containerArguments('job', 'image', '/safe/package', '/safe/work', 'node', 'scripts/run.js', ['a & b'])
  expect(args).toContain('--network=none'); expect(args).toContain('--read-only')
  expect(args).toContain('--cap-drop=ALL'); expect(args).toContain('--security-opt=no-new-privileges')
  expect(JSON.parse(args.at(-1)!).commands[0].at(-1)).toBe('a & b')
  expect(args).toContain('type=bind,source=/safe/work,target=/inputwork,readonly')
  expect(args).toContain('--tmpfs=/work:rw,nosuid,size=64m')
  expect(args.join(' ')).not.toContain('docker.sock')
})
it('rejects untrusted container exports before writing any host files', () => {
  const payload = (path: string, data = 'YQ==') => JSON.stringify({ files: [{ path, data }] })
  for (const path of ['../escape', '/root', 'x\\y', 'CON.txt', 'x:y', 'file.', 'file ']) expect(() => exportedFiles(payload(path))).toThrow()
  expect(() => exportedFiles(payload('a', 'not base64'))).toThrow()
  expect(() => exportedFiles(JSON.stringify({ files: [{ path: 'A', data: '' }, { path: 'a', data: '' }] }))).toThrow()
  expect(() => exportedFiles(payload('big', Buffer.alloc(200001).toString('base64')))).toThrow()
  expect(exportedFiles(payload('notes/a.txt'))[0].data.toString()).toBe('a')
  expect(exportedFiles(payload('deps/library.so', Buffer.alloc(4 * 1024 * 1024).toString('base64')), true)[0].data.length).toBe(4 * 1024 * 1024)
})
it('refuses scripts unless both snapshot and current contact authorize them', async () => {
  const { runner, snapshot } = setup()
  await expect(runner.run('alice', snapshot, 'script', 'scripts/run.js', [], new AbortController().signal)).rejects.toThrow(/授权/)
})
it('preserves internal dependency command links and rejects escaping or runtime links', () => {
  const payload = (link: string) => JSON.stringify({ files: [{ path: 'package/node_modules/.bin/cli', data: '', link }] })
  expect(exportedFiles(payload('../cli/bin.js'), true)[0].link).toBe('../cli/bin.js')
  for (const link of ['../../../../escape', '/etc/passwd', 'C:\\x', '../bad\0']) expect(() => exportedFiles(payload(link), true)).toThrow()
  expect(() => exportedFiles(payload('../cli/bin.js'))).toThrow()
})
it('imports only verified container results and persists execution logs', async () => {
  const { runner, library } = setup()
  library.configure('alice', 'script', 'enable_scripts', 1)
  vi.spyOn(runner, 'status').mockResolvedValue({ ready: true, engineReady: true, message: 'fixture' })
  const command = vi.spyOn(runner as any, 'command').mockImplementation(async (...args: any[]) => args[0][0] === 'run' ? JSON.stringify({ files: [{ path: 'result.txt', data: Buffer.from('actual imported text').toString('base64') }] }) : '')
  const result = await runner.run('alice', library.snapshot('alice'), 'script', 'scripts/run.js', [], new AbortController().signal)
  expect(result.summary).toContain('1 个')
  expect(runner.readFile('alice', library.snapshot('alice'), 'script', 'result.txt', 'workspace')).toBe('actual imported text')
  expect(runner.logs('alice')[0].status).toBe('completed')
  expect(command.mock.calls.some(args => (args[0] as string[])[0] === 'rm')).toBe(true)
})
it('keeps existing files after rejected container output and releases the workspace lock', async () => {
  const { runner, library } = setup()
  library.configure('alice', 'script', 'enable_scripts', 1)
  const snapshot = library.snapshot('alice')
  runner.writeFile('alice', snapshot, 'script', 'keep.txt', 'original')
  vi.spyOn(runner, 'status').mockResolvedValue({ ready: true, engineReady: true, message: 'fixture' })
  vi.spyOn(runner as any, 'command').mockImplementation(async (...args: any[]) => args[0][0] === 'run' ? JSON.stringify({ files: [{ path: '../outside', data: '' }] }) : '')
  await expect(runner.run('alice', snapshot, 'script', 'scripts/run.js', [], new AbortController().signal)).rejects.toThrow(/路径/)
  expect(runner.readFile('alice', snapshot, 'script', 'keep.txt', 'workspace')).toBe('original')
  runner.writeFile('alice', snapshot, 'script', 'after.txt', 'lock released')
  expect(runner.logs('alice')[0].status).toBe('failed')
})
it('reads permission changes across runner instances without waiting for identity sync', async () => {
  const { runner, library } = setup(), worker = new SkillRunner(library)
  runner.updateToolPolicy(true, [])
  expect(() => worker.assertToolAllowed('run_skill_script')).not.toThrow()
  runner.updateToolPolicy(true, ['run_skill_script'])
  expect(() => worker.assertToolAllowed('run_skill_script')).toThrow(/禁用/)
  expect(() => worker.assertToolAllowed('read_skill_file')).not.toThrow()
  runner.updateToolPolicy(false, [])
  expect(() => worker.assertToolAllowed('read_skill_file')).toThrow(/禁用/)
})
it('restores previously committed workspace files after a crash between directory renames', () => {
  const { runner, library, snapshot } = setup()
  runner.writeFile('alice', snapshot, 'script', 'keep.txt', 'original')
  const workspace = runner.workspace('alice', 'script'), id = randomUUID(), runtime = join(library.root, 'runtime')
  renameSync(workspace, join(runtime, `previous-${id}`))
  mkdirSync(join(runtime, `output-${id}`)); writeFileSync(join(runtime, `output-${id}`, 'new.txt'), 'uncommitted')
  const key = createHash('sha256').update('alice\0script').digest('hex')
  writeFileSync(join(runtime, `transaction-${key}.json`), JSON.stringify({ id, state: 'prepared', pid: -1 }))
  expect(new SkillRunner(library).readFile('alice', snapshot, 'script', 'keep.txt', 'workspace')).toBe('original')
})
it('cancels a running operation when the shared permission is revoked', async () => {
  const { runner, library } = setup()
  library.configure('alice', 'script', 'enable_scripts', 1)
  runner.updateToolPolicy(true, [])
  vi.spyOn(runner, 'status').mockResolvedValue({ ready: true, engineReady: true, message: 'fixture' })
  let started!: () => void
  const starting = new Promise<void>(resolve => { started = resolve })
  vi.spyOn(runner as any, 'command').mockImplementation(async (...args: any[]) => {
    if (args[0][0] !== 'run') return ''
    started()
    return new Promise((_resolve, reject) => args[1].addEventListener('abort', () => reject(new Error('cancelled')), { once: true }))
  })
  const running = runner.run('alice', library.snapshot('alice'), 'script', 'scripts/run.js', [], new AbortController().signal)
  const assertion = expect(running).rejects.toThrow('cancelled')
  await starting
  new SkillRunner(library).updateToolPolicy(false, [])
  await assertion
  expect(runner.logs('alice')[0].status).toBe('cancelled')
})
