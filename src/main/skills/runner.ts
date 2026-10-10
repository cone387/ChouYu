import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import type { SkillRunLog, SkillRuntimeStatus, SkillSnapshot } from '../../shared/skills'
import { SkillLibrary } from './library'
import { writeStoreFile } from '../store-file'
import { CONTAINER_WORKER, DEPENDENCY_LIMIT, WORK_LIMIT, exportedFiles, RESTORE_DEPENDENCY_LINKS } from './container-worker'

const BASE = 'chouyu-skill-runtime:2'
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const environment = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(?:PATH|SystemRoot|WINDIR|TEMP|TMP|USERPROFILE|HOME|LOCALAPPDATA|APPDATA|ProgramData|ProgramFiles|DOCKER_HOST|DOCKER_CONTEXT)$/i.test(key))) as NodeJS.ProcessEnv
const dockerfile = 'FROM node:24-bookworm-slim\nRUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip python3-venv bash ca-certificates && rm -rf /var/lib/apt/lists/*\nRUN mkdir -p /work /deps/python && chmod 777 /work\nENV HOME=/tmp PYTHONPATH=/deps/python PYTHONDONTWRITEBYTECODE=1\nWORKDIR /work\nUSER 1000:1000\n'

export function scriptArguments(raw: string): string[] {
  let args: unknown
  try { args = JSON.parse(raw || '[]') } catch { throw new Error('脚本参数必须是 JSON 字符串数组。') }
  if (!Array.isArray(args) || args.length > 32 || args.some(arg => typeof arg !== 'string' || arg.length > 4000 || arg.includes('\0'))) throw new Error('脚本参数无效（最多 32 个文本参数）。')
  return args
}
function safePath(root: string, name: string, createParents = false): string {
  if (typeof name !== 'string' || !name || name.length > 500 || /[\x00-\x1f:]/.test(name) || isAbsolute(name) || name.includes('\\') || name.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) throw new Error('技能文件路径无效。')
  if (lstatSync(root).isSymbolicLink()) throw new Error('技能目录不能是链接。')
  const target = resolve(root, name), rel = relative(root, target)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('技能路径越界。')
  let current = root
  for (const part of name.split('/')) {
    current = join(current, part)
    let stat: ReturnType<typeof lstatSync> | undefined
    try { stat = lstatSync(current) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (stat) {
      if (stat.isSymbolicLink() || stat.isFile() && stat.nlink !== 1) throw new Error('技能工作目录不能读取或写入链接。')
      const actual = relative(realpathSync(root), realpathSync(current))
      if (actual.startsWith('..') || isAbsolute(actual)) throw new Error('技能路径越界。')
    } else if (createParents && current !== target) mkdirSync(current)
  }
  return target
}
export function containerArguments(name: string, image: string, packageRoot: string | undefined, workspace: string, runtime: 'node' | 'python' | 'shell', script: string, args: string[], timeoutMs = 60000) {
  if ([packageRoot, workspace].some(path => path && /[,\r\n]/.test(path))) throw new Error('运行目录包含 Docker 不支持的字符。')
  const executable = runtime === 'node' ? 'node' : runtime === 'python' ? 'python3' : 'bash'
  const spec = { timeoutMs, cwd: '/work', copies: [{ from: '/inputwork', to: '/work' }], commands: [[executable, `/skill/${script}`, ...args]], exports: [{ root: '/work', prefix: '' }], maxEntries: 256, maxFile: 200000, maxBytes: WORK_LIMIT }
  return [...containerConstraints(name, 'none'), '--tmpfs=/work:rw,nosuid,size=64m',
    ...(packageRoot ? ['--mount', `type=bind,source=${packageRoot},target=/skill,readonly`] : []), '--mount', `type=bind,source=${workspace},target=/inputwork,readonly`, '--workdir=/work', image, 'node', '-e', CONTAINER_WORKER, JSON.stringify(spec)]
}
function containerConstraints(name: string, network: 'none' | 'bridge') {
  return ['run', '--rm', '--name', name, '--label=chouyu.skills=1', `--network=${network}`, '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=64', '--memory=768m', '--cpus=1', '--ulimit=fsize=67108864:67108864', '--user=1000:1000', '--tmpfs=/tmp:rw,noexec,nosuid,size=96m']
}

export class SkillRunner {
  private readonly root: string
  private active = new Map<string, { owner: string; skill?: string; controller: AbortController; name?: string }>()
  private preparing = new Set<string>()
  constructor(private readonly library: SkillLibrary) { this.root = join(library.root, 'runtime'); mkdirSync(join(this.root, 'logs'), { recursive: true }) }
  private save(log: SkillRunLog) { writeStoreFile(join(this.root, 'logs', `${log.id}.json`), JSON.stringify(log), JSON.parse) }
  updateToolPolicy(enabled: boolean, disabled: string[]) {
    writeStoreFile(join(this.root, 'tool-policy.json'), JSON.stringify({ enabled, disabled }), JSON.parse)
    if (!enabled || disabled.includes('run_skill_script')) this.cancel()
  }
  assertToolAllowed(name: string) {
    const file = join(this.root, 'tool-policy.json')
    if (!existsSync(file)) return
    const policy = JSON.parse(readFileSync(file, 'utf8'))
    if (policy.enabled !== true || !Array.isArray(policy.disabled) || policy.disabled.includes(name)) throw new Error('技能工具已被用户禁用。')
  }
  private removeDirectory(directory: string) {
    const rel = relative(resolve(this.root), resolve(directory))
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('运行目录清理路径无效。')
    rmSync(directory, { recursive: true, force: true })
  }
  private lock(owner: string, id: string) {
    const file = join(this.root, `lock-${hash(owner + '\0' + id)}.json`)
    if (existsSync(file)) {
      const saved = JSON.parse(readFileSync(file, 'utf8'))
      let alive = true
      try { if (!Number.isSafeInteger(saved.pid) || saved.pid <= 0) throw new Error('Invalid lock'); process.kill(saved.pid, 0) } catch { alive = false }
      if (alive) throw new Error('该技能正在读写工作文件，请稍后重试。')
      rmSync(file)
    }
    writeFileSync(file, JSON.stringify({ pid: process.pid }), { flag: 'wx' })
    return () => rmSync(file, { force: true })
  }
  private inventory(root: string) {
    let count = 0, bytes = 0
    const visit = (dir: string, depth = 0) => {
      if (depth > 24) throw new Error('技能工作目录层级过多。')
      for (const file of readdirSync(dir)) {
        if (++count > 256) throw new Error('技能工作目录条目过多。')
        const target = safePath(root, relative(root, join(dir, file)).replaceAll('\\', '/')), stat = lstatSync(target)
        if (stat.isDirectory()) visit(target, depth + 1)
        else if (!stat.isFile() || stat.size > 200000 || (bytes += stat.size) > WORK_LIMIT) throw new Error('技能工作目录超过容量限制。')
      }
    }
    visit(root); return { count, bytes }
  }
  private async command(args: string[], signal: AbortSignal, log?: SkillRunLog, timeout = 20000, exports = false): Promise<string> {
    signal.throwIfAborted()
    return new Promise((resolve, reject) => {
      let storageError: Error | undefined
      const child = execFile('docker', args, { windowsHide: true, env: environment(), timeout, maxBuffer: exports ? 96 * 1024 * 1024 : 512 * 1024, signal, encoding: 'utf8' }, (error, stdout, stderr) => {
        if (storageError) reject(storageError)
        else if (error) reject(new Error(signal.aborted ? '操作已取消或超时。' : (stderr || error.message).slice(-3000)))
        else resolve(stdout)
      })
      if (log) {
        const append = (chunk: string) => {
          if (storageError) return
          try { log.output = (log.output + chunk).slice(-60000); this.save(log) }
          catch (error) { storageError = new Error(`运行日志保存失败：${String(error)}`); child.kill(); reject(storageError) }
        }
        if (!exports) child.stdout?.on('data', append)
        child.stderr?.on('data', append)
      }
    })
  }
  async status(): Promise<SkillRuntimeStatus> {
    await this.recover()
    try {
      const os = (await this.command(['info', '--format', '{{.OSType}}'], AbortSignal.timeout(10000))).trim()
      if (os !== 'linux') throw new Error('请切换到 Docker Linux 容器。')
      try { await this.command(['image', 'inspect', BASE], AbortSignal.timeout(10000)); return { ready: true, engineReady: true, message: 'Node、Python 和 Shell 隔离环境已就绪。' } }
      catch { return { ready: false, engineReady: true, message: '首次使用需要准备技能隔离环境。' } }
    } catch (error) { return { ready: false, engineReady: false, message: `Docker 未就绪，请启动 Docker Desktop 的 Linux 引擎。${error instanceof Error ? error.message : ''}`.slice(0, 1200) } }
  }
  private async operation<T>(owner: string, kind: SkillRunLog['kind'], signal: AbortSignal, execute: (log: SkillRunLog, signal: AbortSignal) => Promise<T>, skill?: string, script?: string, name?: string): Promise<T> {
    const controller = new AbortController(), combined = AbortSignal.any([signal, controller.signal])
    const log: SkillRunLog = { id: randomUUID(), characterId: owner, skillId: skill, kind, script, containerName: name, startedAt: Date.now(), status: 'running', output: '', ownerPid: process.pid }
    this.active.set(log.id, { owner, skill, controller, name })
    try { this.save(log); const result = await execute(log, combined); combined.throwIfAborted(); log.status = 'completed'; return result }
    catch (error) { log.status = combined.aborted ? 'cancelled' : 'failed'; log.error = error instanceof Error ? error.message : String(error); throw error }
    finally {
      try {
        if (name) { log.cleanupPending = true; await this.command(['rm', '-f', name], AbortSignal.timeout(10000)).then(() => { log.cleanupPending = false }, () => {}) }
        log.finishedAt = Date.now(); this.save(log)
      } finally { this.active.delete(log.id) }
    }
  }
  async prepare(signal: AbortSignal): Promise<SkillRuntimeStatus> {
    if (this.preparing.has('base')) throw new Error('运行环境正在准备。')
    this.preparing.add('base')
    try {
      const status = await this.status(); if (status.ready) return status
      if (!status.engineReady) throw new Error(status.message)
      return await this.operation('', 'environment', signal, async (log, signal) => {
        const context = join(this.root, `build-${log.id}`); mkdirSync(context)
        try { writeFileSync(join(context, 'Dockerfile'), dockerfile); await this.command(['build', '--pull', '-t', BASE, context], signal, log, 600000) }
        finally { this.removeDirectory(context) }
        return this.status()
      })
    } finally { this.preparing.delete('base') }
  }
  private entry(owner: string, snapshot: SkillSnapshot, id: string, scripts = false) {
    const entry = snapshot.entries.find(item => item.id === id)
    if (!entry) throw new Error('当前联系人未在此轮启用该技能。')
    if (scripts && (!entry.scriptsEnabled || !this.library.list(owner).skills.find(item => item.id === id)?.scriptsEnabled)) throw new Error('尚未授权此联系人的技能脚本，或授权已撤销。')
    return { entry, directory: this.library.packageDirectory(id, entry.digest) }
  }
  private transaction(owner: string, id: string) { return join(this.root, `transaction-${hash(owner + '\0' + id)}.json`) }
  private recoverWorkspace(owner: string, id: string, force = false) {
    const file = this.transaction(owner, id)
    if (!existsSync(file)) return
    const transaction = JSON.parse(readFileSync(file, 'utf8')) as { id: string; state: 'prepared' | 'committed'; pid: number }
    if (!/^[a-f0-9-]{36}$/.test(transaction.id) || !['prepared', 'committed'].includes(transaction.state)) throw new Error('技能工作文件恢复记录无效。')
    let alive = true
    try { if (!Number.isSafeInteger(transaction.pid) || transaction.pid <= 0) throw new Error('Invalid pid'); process.kill(transaction.pid, 0) } catch { alive = false }
    if (alive && !force && transaction.state === 'prepared') throw new Error('技能工作文件正在提交，请稍后重试。')
    const workspace = join(this.root, 'work', hash(owner), hash(id)), backup = join(this.root, `previous-${transaction.id}`), stage = join(this.root, `output-${transaction.id}`)
    if (existsSync(backup) && (transaction.state === 'prepared' || !existsSync(workspace))) {
      this.removeDirectory(workspace); renameSync(backup, workspace)
    }
    this.removeDirectory(backup); this.removeDirectory(stage); rmSync(file)
  }
  workspace(owner: string, id: string) {
    this.recoverWorkspace(owner, id)
    const directory = join(this.root, 'work', hash(owner), hash(id)); mkdirSync(directory, { recursive: true }); return directory
  }
  readFile(owner: string, snapshot: SkillSnapshot, id: string, file: string, source: 'package' | 'workspace') {
    const { directory } = this.entry(owner, snapshot, id)
    const root = source === 'package' ? directory : this.workspace(owner, id), target = safePath(root, file)
    if (!lstatSync(target).isFile() || lstatSync(target).size > 200000) throw new Error('只能读取不超过 200 KB 的技能文本文件。')
    const content = readFileSync(target, 'utf8'); if (content.includes('\0')) throw new Error('此文件不是可读取的文本。')
    return content
  }
  writeFile(owner: string, snapshot: SkillSnapshot, id: string, file: string, content: string) {
    this.entry(owner, snapshot, id)
    if (typeof content !== 'string' || Buffer.byteLength(content) > 200000) throw new Error('技能文件最多 200 KB。')
    const release = this.lock(owner, id)
    try {
      const root = this.workspace(owner, id), inventory = this.inventory(root), target = safePath(root, file, true)
      if (inventory.bytes + Buffer.byteLength(content) > WORK_LIMIT || inventory.count >= 128) throw new Error('技能工作文件超过 8 MB 或 128 个条目的限制。')
      const temporary = join(dirname(target), `.write-${randomUUID()}`)
      try { writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx' }); safePath(root, file); renameSync(temporary, target) }
      finally { rmSync(temporary, { force: true }) }
      return `已保存工作文件：${file}`
    } finally { release() }
  }
  async prepareDependencies(owner: string, id: string, signal: AbortSignal) {
    const snapshot = this.library.snapshot(owner), { entry, directory } = this.entry(owner, snapshot, id)
    if (this.preparing.has(entry.digest)) throw new Error('此技能的依赖正在准备。')
    this.preparing.add(entry.digest)
    try {
      const status = await this.status(); if (!status.ready) throw new Error(status.message)
      const name = `chouyu-skill-${randomUUID()}`
      await this.operation(owner, 'dependencies', signal, async (log, signal) => {
        const context = join(this.root, `build-${log.id}`); mkdirSync(context)
        try {
          const files = this.library.detail(id).skill.compatibility!.dependencyFiles
          const commands: string[][] = []
          for (const file of files) {
            if (/(^|\/)package\.json$/.test(file)) commands.push(['npm', 'install', '--ignore-scripts', '--omit=dev', '--prefix', '/skill/' + (dirname(file) === '.' ? '' : dirname(file).replaceAll('\\', '/'))])
            else if (/(^|\/)requirements[^/]*\.txt$/.test(file)) commands.push(['python3', '-m', 'pip', 'install', '--only-binary=:all:', '--no-cache-dir', '--target', '/deps/python', '-r', '/skill/' + file])
            else if (!/(^|\/)package-lock\.json$/.test(file)) throw new Error(`暂不支持自动准备 ${file}；请提供 requirements.txt 或 package.json 依赖清单。`)
          }
          if (!commands.length) throw new Error('此技能没有可准备的依赖清单。')
          if (/[,\r\n]/.test(directory)) throw new Error('技能目录不能包含逗号或换行。')
          const spec = { timeoutMs: 600000, dependencies: true, cwd: '/skill', copies: [{ from: '/inputskill', to: '/skill' }], commands, exports: [{ root: '/skill', prefix: 'package/' }, { root: '/deps', prefix: 'deps/' }], maxEntries: 16000, maxFile: 16 * 1024 * 1024, maxBytes: DEPENDENCY_LIMIT }
          const raw = await this.command([...containerConstraints(name, 'bridge'), '--tmpfs=/skill:rw,nosuid,size=192m,mode=1777', '--tmpfs=/deps:rw,nosuid,size=192m,mode=1777', '--mount', `type=bind,source=${directory},target=/inputskill,readonly`, '--workdir=/skill', BASE, 'node', '-e', CONTAINER_WORKER, JSON.stringify(spec)], signal, log, 600000, true)
          const links: { path: string; target: string }[] = []
          for (const file of exportedFiles(raw, true)) {
            if (!file.path.startsWith('package/') && !file.path.startsWith('deps/')) throw new Error('依赖输出路径无效。')
            const destination = safePath(context, file.path, true)
            if (file.link) links.push({ path: file.path.startsWith('package/') ? '/skill/' + file.path.slice(8) : '/' + file.path, target: file.link })
            else writeFileSync(destination, file.data, { flag: 'wx' })
          }
          mkdirSync(join(context, 'deps'), { recursive: true })
          writeFileSync(join(context, 'links.json'), JSON.stringify(links))
          writeFileSync(join(context, 'Dockerfile'), `FROM ${BASE}\nUSER root\nCOPY --chmod=755 package /skill\nCOPY --chmod=755 deps /deps\nCOPY links.json /chouyu-links.json\nRUN ${JSON.stringify(['node', '-e', RESTORE_DEPENDENCY_LINKS])}\nUSER 1000:1000\n`)
          await this.command(['build', '-t', `chouyu-skill-${entry.digest}:2`, context], signal, log, 120000)
        } finally { this.removeDirectory(context) }
      }, id, undefined, name)
    } finally { this.preparing.delete(entry.digest) }
  }
  async run(owner: string, snapshot: SkillSnapshot, id: string, file: string, args: string[], signal: AbortSignal, timeoutMs = 60000) {
    this.assertToolAllowed('run_skill_script')
    const { entry, directory } = this.entry(owner, snapshot, id, true), detail = this.library.detail(id)
    const script = detail.skill.compatibility!.scripts.find(item => item.path === file)
    if (!script) throw new Error('只能运行技能包中已登记的 Node/Python/Shell 脚本。')
    safePath(directory, file); scriptArguments(JSON.stringify(args))
    const status = await this.status(); if (!status.ready) throw new Error(status.message)
    const dependencies = detail.skill.compatibility!.dependencyFiles.length > 0
    const image = dependencies ? `chouyu-skill-${entry.digest}:2` : BASE
    if (dependencies) try { await this.command(['image', 'inspect', image], signal) } catch { throw new Error('技能依赖尚未准备，请在技能详情中准备依赖。') }
    const name = `chouyu-skill-${randomUUID()}`, release = this.lock(owner, id)
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(Math.max(100, Math.min(timeoutMs, 120000)))])
    try { return await this.operation(owner, 'script', deadline, async (log, activeSignal) => {
      const checker = setInterval(() => { try { this.assertToolAllowed('run_skill_script'); this.entry(owner, snapshot, id, true) } catch { this.active.get(log.id)?.controller.abort() } }, 500)
      try {
        const workspace = this.workspace(owner, id); this.inventory(workspace)
        activeSignal.throwIfAborted(); this.assertToolAllowed('run_skill_script'); this.entry(owner, snapshot, id, true)
        const raw = await this.command(containerArguments(name, image, dependencies ? undefined : directory, workspace, script.runtime, file, args, timeoutMs), activeSignal, log, Math.max(100, Math.min(timeoutMs, 120000)), true)
        activeSignal.throwIfAborted(); this.assertToolAllowed('run_skill_script'); this.entry(owner, snapshot, id, true)
        const files = exportedFiles(raw), stage = join(this.root, `output-${log.id}`); mkdirSync(stage)
        try {
          for (const item of files) writeFileSync(safePath(stage, item.path, true), item.data, { flag: 'wx' })
          this.inventory(stage)
          const backup = join(this.root, `previous-${log.id}`)
          const transaction = this.transaction(owner, id)
          writeStoreFile(transaction, JSON.stringify({ id: log.id, state: 'prepared', pid: process.pid }), JSON.parse)
          try {
            renameSync(workspace, backup); renameSync(stage, workspace)
            writeStoreFile(transaction, JSON.stringify({ id: log.id, state: 'committed', pid: process.pid }), JSON.parse)
          } catch (error) { this.recoverWorkspace(owner, id, true); throw error }
          this.recoverWorkspace(owner, id, true)
        } finally { this.removeDirectory(stage) }
        return { id: log.id, output: log.output.slice(-50000), summary: `脚本 ${file} 已完成；保存 ${files.length} 个工作文件。` }
      } finally { clearInterval(checker) }
    }, id, file, name) } finally { release() }
  }
  private async recover() {
    for (const file of readdirSync(join(this.root, 'logs')).filter(file => /^[a-f0-9-]+\.json$/.test(file))) {
      let log: SkillRunLog
      try { log = JSON.parse(readFileSync(join(this.root, 'logs', file), 'utf8')) } catch { continue }
      let alive = true
      try { if (!Number.isSafeInteger(log.ownerPid) || log.ownerPid <= 0) throw new Error('Invalid pid'); process.kill(log.ownerPid, 0) } catch { alive = false }
      if ((log.status !== 'running' || alive) && !log.cleanupPending) continue
      if (log.containerName && /^chouyu-skill-[a-f0-9-]{36}$/.test(log.containerName)) {
        log.cleanupPending = true
        await this.command(['rm', '-f', log.containerName], AbortSignal.timeout(10000)).then(() => { log.cleanupPending = false }, () => {})
      }
      if (log.status === 'running') { log.status = 'interrupted'; log.finishedAt = Date.now(); log.error = '执行进程已退出；未确认成功的工作文件不会导入。' }
      this.save(log)
    }
  }
  logs(owner: string, skill?: string): SkillRunLog[] {
    return readdirSync(join(this.root, 'logs')).filter(file => /^[a-f0-9-]+\.json$/.test(file)).flatMap(file => {
      try {
        const log = JSON.parse(readFileSync(join(this.root, 'logs', file), 'utf8')) as SkillRunLog
        if (log.characterId !== owner && log.kind !== 'environment' || skill && log.skillId !== skill && log.kind !== 'environment') return []
        return [log]
      } catch { return [] }
    }).sort((a, b) => b.startedAt - a.startedAt).slice(0, 30)
  }
  cancel(owner?: string, skill?: string) { for (const operation of this.active.values()) if ((owner === undefined || operation.owner === owner) && (!skill || operation.skill === skill)) operation.controller.abort() }
}
