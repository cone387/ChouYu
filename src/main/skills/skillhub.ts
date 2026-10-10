import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { skillReference, type SkillHubStatus, type SkillSearchResult } from '../../shared/skills'
import { SkillLibrary } from './library'

const VERSION = '2026.8.5'
const KIT_URL = `https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/skillhub-cli-${VERSION}.tar.gz`
const KIT_SHA256 = '3bbe2ba15ada2eb7a94a2b760fead83be5f4164ab28a6c8b0944dbc539f7e236'
const FILES: Record<string, string> = {
  'skills_store_cli.py': '6c5c89142b32b92d212d7b86821ba1f3cc0d6dc68df6d901e0ef38ece4add797',
  'skills_upgrade.py': '893374aae5d4941c3ededbd0be96366552ab959ed40a18f648aa30fb65116e05',
  'version.json': 'fff513acaf76390d2a9c23c0bdba00054c7db1d3d0473080e14c0f6ebe0c6514',
  'metadata.json': 'daccf1c7ae782a3d48183cd32a8bbcb1c0673724f647cbcafb1e4732e7b281fa'
}
const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex')
type ProcessOptions = { signal?: AbortSignal; cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number }
export function runProcess(file: string, args: string[], options: ProcessOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { ...options, timeout: options.timeout ?? 90000, maxBuffer: 1024 * 1024, windowsHide: true, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (!error) { resolve(stdout); return }
      if (options.signal?.aborted) { reject(new Error('操作已取消。')); return }
      if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') { reject(new Error('SkillHub 输出超过允许大小。')); return }
      if (error.killed) { reject(new Error('SkillHub 请求超时，请重试。')); return }
      let message = ''
      try { message = String(JSON.parse(stdout).error || '') } catch { /* Non-JSON failures use bounded stderr. */ }
      reject(new Error((message || stderr || error.message).slice(0, 1500)))
    })
  })
}

export function parseSearchResults(raw: string): SkillSearchResult[] {
  if (raw.trim() === 'No skills found.') return []
  let data: { results?: unknown[]; warnings?: unknown[] }
  try { data = JSON.parse(raw) } catch { throw new Error('SkillHub 搜索未返回有效结果，请重试。') }
  if (!data || !Array.isArray(data.results)) throw new Error('SkillHub 搜索结果格式无效。')
  if (data.warnings?.length) throw new Error(`SkillHub 搜索未完整成功：${data.warnings.map(String).join('；').slice(0, 600)}`)
  return data.results.slice(0, 30).flatMap(value => {
    if (!value || typeof value !== 'object') return []
    const item = value as Record<string, unknown>
    let id: string
    try { id = skillReference(item.slug) } catch { return [] }
    return [{ id, name: typeof item.name === 'string' ? item.name.slice(0, 120) : id, description: typeof item.description === 'string' ? item.description.slice(0, 2000) : '', ...(typeof item.version === 'string' && item.version ? { version: item.version.slice(0, 80) } : {}) }]
  })
}

// Wrap the official CLI without editing its files. No skill code is executed.
// Extraction is bounded before writing and remote traffic stays on official hosts.
export const SKILLHUB_RUNNER = String.raw`
import sys, os, pathlib, runpy, zipfile, urllib.request, urllib.parse
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')
allowed={'api.skillhub.cn','skillhub.cn','skillhub-1388575217.cos.ap-guangzhou.myqcloud.com','skillhub-1388575217.cos.accelerate.myqcloud.com'}
def check_url(url):
    parsed=urllib.parse.urlsplit(url)
    if parsed.scheme!='https' or parsed.hostname not in allowed or parsed.username or parsed.password or parsed.port not in (None,443):
        raise ValueError('SkillHub download source is not an official HTTPS endpoint')
class Redirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        check_url(newurl)
        return super().redirect_request(req,fp,code,msg,headers,newurl)
urllib.request.install_opener(urllib.request.build_opener(Redirect()))
original_open=urllib.request.urlopen
class BoundedResponse:
    def __init__(self,response): self.response=response; self.total=0
    def __getattr__(self,name): return getattr(self.response,name)
    def __enter__(self): return self
    def __exit__(self,*args): self.response.close()
    def read(self,size=-1):
        data=self.response.read(min(size if size>=0 else 20971521,20971521-self.total))
        self.total+=len(data)
        if self.total>20971520: raise ValueError('SkillHub response exceeds 20 MB')
        return data
def bounded_open(url,*args,**kwargs):
    check_url(url.full_url if hasattr(url,'full_url') else url)
    return BoundedResponse(original_open(url,*args,**kwargs))
urllib.request.urlopen=bounded_open
original_extract=zipfile.ZipFile.extractall
def safe_extract(self,path=None,members=None,pwd=None):
    root=pathlib.Path(path or os.getcwd()).resolve()
    entries=self.infolist(); total=0; names=set()
    if len(entries)>200: raise ValueError('Skill package has too many files')
    for item in entries:
        name=item.filename.replace('\\','/')
        parts=pathlib.PurePosixPath(name).parts
        if name.startswith('/') or ':' in name or '..' in parts or len(parts)>16 or any(p.rstrip(' .')!=p or p.split('.')[0].upper() in {'CON','PRN','AUX','NUL',*[f'COM{i}' for i in range(10)],*[f'LPT{i}' for i in range(10)]} for p in parts):
            raise ValueError('Unsafe skill package path')
        if (item.external_attr>>16)&0o170000==0o120000: raise ValueError('Skill links are not supported')
        target=(root/name).resolve()
        if not target.is_relative_to(root): raise ValueError('Skill path is outside target')
        key=str(target).lower()
        if key in names: raise ValueError('Duplicate skill package path')
        names.add(key); total+=item.file_size
        if total>10485760: raise ValueError('Skill package exceeds 10 MB')
    return original_extract(self,path,members,pwd)
zipfile.ZipFile.extractall=safe_extract
script=sys.argv[1]
sys.argv=sys.argv[1:]
sys.path.insert(0,str(pathlib.Path(script).parent))
module=runpy.run_path(script,run_name='chouyu_skillhub')
original_search=module['fetch_remote_search_results']
def checked_search(*args,**kwargs):
    result=original_search(*args,**kwargs)
    if result is None: raise RuntimeError('SkillHub search request failed; please retry')
    return result
module['main'].__globals__['fetch_remote_search_results']=checked_search
module['main']()
`

export class SkillHub {
  private python?: { file: string; args: string[] }
  private setupPending?: Promise<SkillHubStatus>
  private installing = new Set<string>()
  private readonly cli: string
  private readonly home: string
  constructor(readonly root: string, private readonly library: SkillLibrary) {
    this.root = resolve(root)
    this.cli = join(this.root, `skillhub-${VERSION}`); this.home = join(this.root, 'skillhub-home')
  }
  private async detectPython() {
    if (this.python) return this.python
    const candidates = process.platform === 'win32' ? [{ file: 'python', args: [] }, { file: 'py', args: ['-3'] }] : [{ file: 'python3', args: [] }, { file: 'python', args: [] }]
    for (const candidate of candidates) {
      try {
        await runProcess(candidate.file, [...candidate.args, '-I', '-c', 'import sys; assert sys.version_info >= (3, 10); print("ok")'], { timeout: 5000 })
        this.python = candidate; return candidate
      } catch { /* Try the next standard Python launcher. */ }
    }
    throw new Error('需要 Python 3.10 或更高版本。请安装 Python 并添加到 PATH，重启 ChouYu 后重试。')
  }
  private verify() {
    for (const [name, hash] of Object.entries(FILES)) if (!existsSync(join(this.cli, name)) || digest(readFileSync(join(this.cli, name))) !== hash) throw new Error('SkillHub 尚未安装或文件校验失败，请安装商店。')
  }
  async status(): Promise<SkillHubStatus> {
    try { this.verify(); await this.detectPython(); return { ready: true, version: VERSION } } catch (error) { return { ready: false, error: (error as Error).message } }
  }
  async setup(signal?: AbortSignal): Promise<SkillHubStatus> {
    if (this.setupPending) throw new Error('SkillHub 正在安装，请等待当前操作完成。')
    this.setupPending = this.setupOnce(signal)
    try { return await this.setupPending } finally { this.setupPending = undefined }
  }
  private async setupOnce(signal?: AbortSignal) {
    const python = await this.detectPython()
    if ((await this.status()).ready) return { ready: true, version: VERSION }
    mkdirSync(this.root, { recursive: true })
    const staging = join(this.root, `setup-${randomUUID()}`)
    mkdirSync(staging)
    try {
      const response = await fetch(KIT_URL, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000), redirect: 'error' })
      if (!response.ok || !response.body) throw new Error(`SkillHub 下载失败（${response.status}）。`)
      const chunks: Uint8Array[] = []; let size = 0
      for await (const chunk of response.body) { size += chunk.length; if (size > 5 * 1024 * 1024) { await response.body.cancel().catch(() => {}); throw new Error('SkillHub 安装包过大。') }; chunks.push(chunk) }
      const archive = Buffer.concat(chunks)
      if (digest(archive) !== KIT_SHA256) throw new Error('SkillHub 安装包校验失败，未安装。')
      const filename = join(staging, 'kit.tar.gz'); writeFileSync(filename, archive)
      await runProcess(python.file, [...python.args, '-I', '-c', 'import tarfile,pathlib,sys\np=pathlib.Path(sys.argv[2])\nwith tarfile.open(sys.argv[1]) as t:\n for name in sys.argv[3:]:\n  m=t.getmember("cli/"+name)\n  assert m.isfile() and m.size<2000000\n  (p/name).write_bytes(t.extractfile(m).read())', filename, staging, ...Object.keys(FILES)], { signal })
      for (const [name, hash] of Object.entries(FILES)) if (digest(readFileSync(join(staging, name))) !== hash) throw new Error('SkillHub 文件校验失败。')
      signal?.throwIfAborted()
      rmSync(filename)
      if (existsSync(this.cli)) renameSync(this.cli, `${this.cli}-invalid-${randomUUID()}`)
      renameSync(staging, this.cli)
      await this.invoke(['--version'], signal)
      return { ready: true, version: VERSION }
    } finally { if (existsSync(staging)) rmSync(staging, { recursive: true, force: true }) }
  }
  private async invoke(args: string[], signal?: AbortSignal, cwd = this.home) {
    this.verify()
    const python = await this.detectPython()
    mkdirSync(this.home, { recursive: true }); mkdirSync(cwd, { recursive: true })
    const config = join(this.home, 'config.json'), index = join(this.home, 'empty-index.json')
    if (!existsSync(config)) writeFileSync(config, JSON.stringify({ auto_self_upgrade: false, install_workspace_skills: false, report_caller_type: false }))
    if (!existsSync(index)) writeFileSync(index, '{"skills":[]}')
    const env = { ...process.env }
    for (const name of Object.keys(env)) if (/^(?:SKILLHUB_|PYTHON)/i.test(name)) delete env[name]
    Object.assign(env, { HOME: this.home, USERPROFILE: this.home, PYTHONIOENCODING: 'utf-8', SKILLHUB_CONFIG_PATH: config, SKILLHUB_CLAWHUB_LOCK_PATH: join(this.home, 'clawhub-lock.json'), SKILLHUB_SKIP_SELF_UPGRADE: '1', SKILLHUB_SKIP_WORKSPACE_SKILLS: '1', SKILLHUB_CALLER: 'none' })
    return runProcess(python.file, [...python.args, '-I', '-c', SKILLHUB_RUNNER, join(this.cli, 'skills_store_cli.py'), '--skip-self-upgrade', '--index', index, ...args], { env, cwd, signal })
  }
  async search(query: string, signal?: AbortSignal) {
    if (typeof query !== 'string' || !query.trim() || query.length > 200 || query.trim().startsWith('-')) throw new Error('请输入 1–200 字的技能关键词。')
    return parseSearchResults(await this.invoke(['search', '--json', '--org', 'community', '--search-limit', '20', query.trim()], signal))
  }
  async install(id: string, signal?: AbortSignal) {
    skillReference(id)
    if (this.installing.has(id)) throw new Error('该技能正在安装。')
    if (this.library.list('').skills.some(skill => skill.id === id)) throw new Error('该技能已安装。')
    this.installing.add(id)
    const staging = join(this.root, `download-${randomUUID()}`)
    mkdirSync(staging, { recursive: true })
    try {
      const raw = await this.invoke(['install', id, '--dir', staging, '--json'], signal, staging)
      const result = JSON.parse(raw)
      if (result.success !== true) throw new Error(String(result.error || 'SkillHub 未确认安装成功。'))
      const folders = readdirSync(staging, { withFileTypes: true }).filter(entry => entry.isDirectory())
      const target = typeof result.targetDir === 'string' ? result.targetDir : folders.length === 1 ? join(staging, folders[0].name) : ''
      const rel = relative(staging, target)
      if (!target || isAbsolute(rel) || rel === '..' || rel.startsWith('..\\') || rel.startsWith('../')) throw new Error('SkillHub 返回了无效安装目录。')
      signal?.throwIfAborted()
      return this.library.publish(id, target)
    } finally {
      this.installing.delete(id)
      if (existsSync(staging)) rmSync(staging, { recursive: true, force: true })
    }
  }
}
