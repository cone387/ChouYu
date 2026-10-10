import { createHash, randomUUID } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync } from 'node:fs'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import type { ContactSkill, InstalledSkill, SkillAction, SkillListing, SkillSnapshot } from '../../shared/skills'
import { skillInstruction, skillReference } from '../../shared/skills'
import { writeStoreFile } from '../store-file'
import { skillCompatibility, capabilityInstruction } from './compatibility'

const sha = (content: string | Buffer) => createHash('sha256').update(content).digest('hex')
type StoredSkill = InstalledSkill & { directory: string }
type State = { version: 1; skills: StoredSkill[]; contacts: Record<string, { revision: number; skills: Record<string, boolean>; scripts?: Record<string, boolean> }> }
function parseState(raw: string): State {
  const state = JSON.parse(raw) as State
  if (state.version !== 1 || !Array.isArray(state.skills) || !state.contacts || typeof state.contacts !== 'object' || Array.isArray(state.contacts)) throw new Error('Invalid skill library')
  for (const skill of state.skills) {
    skillReference(skill.id)
    if (!/^[a-f0-9]{64}$/.test(skill.directory) || !/^[a-f0-9]{64}$/.test(skill.digest) || typeof skill.name !== 'string' || !Array.isArray(skill.files)) throw new Error('Invalid skill metadata')
  }
  for (const config of Object.values(state.contacts)) {
    if (!Number.isSafeInteger(config.revision) || config.revision < 0 || !config.skills || typeof config.skills !== 'object' || Array.isArray(config.skills)) throw new Error('Invalid contact skill configuration')
    for (const [id, enabled] of Object.entries(config.skills)) { skillReference(id); if (typeof enabled !== 'boolean' || !state.skills.some(skill => skill.id === id)) throw new Error('Invalid skill assignment') }
    if (config.scripts !== undefined && (!config.scripts || typeof config.scripts !== 'object' || Array.isArray(config.scripts))) throw new Error('Invalid skill script permissions')
    if (config.scripts) for (const [id, enabled] of Object.entries(config.scripts)) { skillReference(id); if (typeof enabled !== 'boolean' || !Object.hasOwn(config.skills, id)) throw new Error('Invalid skill script permission') }
  }
  return state
}

function inside(root: string, candidate: string) {
  const rel = relative(realpathSync(root), realpathSync(candidate))
  if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) throw new Error('技能文件越出允许目录。')
}

/** Never execute package contents. Read all text references as a bounded snapshot. */
export function inspectSkillDirectory(directory: string) {
  if (lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory()) throw new Error('技能目录不能是链接。')
  const files: string[] = [], texts: { path: string; content: string }[] = []
  const digest = createHash('sha256')
  let total = 0, textLength = 0, entryCount = 0
  const visit = (base: string, depth = 0) => {
    if (depth > 16) throw new Error('技能目录层级过多。')
    for (const entry of readdirSync(base).sort()) {
      if (++entryCount > 200) throw new Error('技能文件过多（最多 200 个）。')
      const absolute = join(base, entry), stat = lstatSync(absolute)
      if (stat.isSymbolicLink()) throw new Error('技能不能包含符号链接。')
      inside(directory, absolute)
      if (stat.isDirectory()) { visit(absolute, depth + 1); continue }
      if (!stat.isFile()) throw new Error('技能包含不支持的文件类型。')
      total += stat.size
      if (total > 10 * 1024 * 1024) throw new Error('技能文件超过 10 MB。')
      const file = relative(directory, absolute).replaceAll('\\', '/')
      const contents = readFileSync(absolute)
      digest.update(file).update('\0').update(contents).update('\0'); files.push(file)
      if (/\.(?:md|txt|json|ya?ml|csv)$/i.test(extname(file))) {
        const content = contents.toString('utf8')
        if (content.includes('\0')) throw new Error('技能文本包含无效内容。')
        textLength += content.length
        if (textLength > 32000) throw new Error('技能说明及参考文本过长（最多 32000 字符），未截断或启用。')
        texts.push({ path: file, content })
      }
    }
  }
  visit(directory)
  if (files.length > 200) throw new Error('技能文件过多（最多 200 个）。')
  const main = texts.find(file => file.path === 'SKILL.md')?.content
  if (!main?.trim()) throw new Error('技能缺少有效的 SKILL.md。')
  const frontmatter = main.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] ?? ''
  const field = (key: string) => {
    const value = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim().replace(/^['"]|['"]$/g, '')
    if (value === '>' || value === '|') return frontmatter.match(new RegExp(`^${key}:.*\\r?\\n((?:[ \\t]+.+\\r?\\n?)+)`, 'm'))?.[1].trim().replace(/\s+/g, ' ')
    return value
  }
  return { name: (field('name') || '未命名技能').slice(0, 120), description: (field('description') || '').slice(0, 2000), version: field('version')?.slice(0, 80), digest: digest.digest('hex'), files, compatibility: skillCompatibility(files, texts), unavailableReason: undefined, content: texts.map(file => `文件：${file.path}\n${file.content}`).join('\n\n') }
}

export class SkillLibrary {
  private readonly filename: string
  private readonly packages: string
  constructor(readonly root: string) {
    this.root = resolve(root)
    this.filename = join(this.root, 'library.json'); this.packages = join(this.root, 'packages')
    mkdirSync(this.packages, { recursive: true })
  }
  private read(): State {
    if (!existsSync(this.filename)) return { version: 1, skills: [], contacts: {} }
    try { return parseState(readFileSync(this.filename, 'utf8')) } catch { throw new Error('技能库无法读取，原文件已保留。请检查数据目录或恢复备份。') }
  }
  private write(state: State) { writeStoreFile(this.filename, JSON.stringify(state), parseState) }
  private directory(skill: StoredSkill) {
    const directory = resolve(this.packages, skill.directory)
    inside(this.packages, directory)
    return directory
  }
  list(characterId: string): SkillListing {
    const state = this.read(), config = state.contacts[characterId]
    return { revision: config?.revision ?? 0, skills: state.skills.map(({ directory: _, ...stored }): ContactSkill => {
      let skill: InstalledSkill = stored
      try { skill = this.detail(stored.id).skill } catch (error) { skill = { ...stored, unavailableReason: error instanceof Error ? error.message : 'Skill cannot be read' } }
      return { ...skill, assigned: Object.hasOwn(config?.skills ?? {}, skill.id), enabled: config?.skills[skill.id] === true, scriptsEnabled: config?.scripts?.[skill.id] === true,
        usedBy: Object.entries(state.contacts).filter(([, contact]) => Object.hasOwn(contact.skills, skill.id)).map(([id]) => id) }
    }) }
  }

  detail(id: string) {
    skillReference(id)
    const skill = this.read().skills.find(item => item.id === id)
    if (!skill) throw new Error('技能尚未安装。')
    const inspected = inspectSkillDirectory(this.directory(skill))
    if (inspected.digest !== skill.digest) throw new Error('技能文件发生变化，校验失败。请移除关联后重新安装。')
    const { directory: _, ...metadata } = skill
    return { skill: { ...metadata, compatibility: inspected.compatibility, unavailableReason: inspected.unavailableReason }, content: inspected.content }
  }
  publish(id: string, source: string): InstalledSkill {
    skillReference(id)
    const state = this.read()
    if (state.skills.some(skill => skill.id === id)) throw new Error('该技能已安装。')
    const inspected = inspectSkillDirectory(source)
    const directory = sha(id), destination = join(this.packages, directory), staging = join(this.packages, `staging-${randomUUID()}`)
    if (existsSync(destination)) throw new Error('技能目录已存在，请检查上次安装记录。')
    try {
      cpSync(source, staging, { recursive: true, dereference: false, errorOnExist: true, force: false })
      if (inspectSkillDirectory(staging).digest !== inspected.digest) throw new Error('安装过程中技能内容发生变化。')
      renameSync(staging, destination)
      const { content: _, ...metadata } = inspected
      const skill = { ...metadata, id, installedAt: Date.now() }
      state.skills.push({ ...skill, directory })
      try { this.write(state) } catch (error) { rmSync(destination, { recursive: true, force: true }); throw error }
      return skill
    } finally { if (existsSync(staging)) rmSync(staging, { recursive: true, force: true }) }
  }
  configure(characterId: string, id: string, action: SkillAction, revision: number) {
    skillReference(id)
    if (!['enable', 'disable', 'remove', 'enable_scripts', 'disable_scripts'].includes(action) || !Number.isSafeInteger(revision)) throw new Error('技能配置参数无效。')
    const state = this.read(), config = state.contacts[characterId] ?? { revision: 0, skills: {} }
    if (revision !== config.revision) throw new Error('技能配置已变化，请刷新后重试。')
    if (!state.skills.some(skill => skill.id === id)) throw new Error('技能尚未安装。')
    if (action === 'remove') { delete config.skills[id]; if (config.scripts) delete config.scripts[id] }
    else if (action === 'enable' || action === 'enable_scripts') {
      const { skill } = this.detail(id)
      if (skill.unavailableReason) throw new Error(skill.unavailableReason)
      config.skills[id] = true
      if (action === 'enable_scripts') (config.scripts ??= {})[id] = true
      const enabled = Object.entries(config.skills).filter(([, enabled]) => enabled).map(([id]) => id)
      if (enabled.length > 8) throw new Error('每个联系人最多启用 8 个技能。')
      skillInstruction(enabled.map(id => { const detail = this.detail(id); return { id, content: capabilityInstruction(detail.skill.compatibility!, config.scripts?.[id] === true) + '\n' + detail.content } }))
    } else if (action === 'disable_scripts') { if (config.scripts) config.scripts[id] = false }
    else { config.skills[id] = false; if (config.scripts) config.scripts[id] = false }
    state.contacts[characterId] = { ...config, revision: config.revision + 1 }
    this.write(state)
    return this.list(characterId)
  }
  snapshot(characterId: string): SkillSnapshot {
    const enabled = this.list(characterId).skills.filter(skill => skill.enabled)
    return { entries: enabled.map(skill => ({ id: skill.id, digest: skill.digest, scriptsEnabled: skill.scriptsEnabled === true })), instruction: skillInstruction(enabled.map(skill => {
      const detail = this.detail(skill.id)
      return { id: skill.id, content: capabilityInstruction(detail.skill.compatibility!, skill.scriptsEnabled === true) + '\n' + detail.content }
    })) }
  }
  packageDirectory(id: string, digest: string) {
    const skill = this.read().skills.find(item => item.id === skillReference(id))
    if (!skill || skill.digest !== digest || this.detail(id).skill.digest !== digest) throw new Error('Skill version does not match the running snapshot')
    return this.directory(skill)
  }

  removeContact(characterId: string) {
    const state = this.read()
    if (Object.hasOwn(state.contacts, characterId)) { delete state.contacts[characterId]; this.write(state) }
  }
  uninstall(id: string) {
    skillReference(id)
    const state = this.read(), skill = state.skills.find(item => item.id === id)
    if (!skill) throw new Error('技能尚未安装。')
    if (Object.values(state.contacts).some(contact => Object.hasOwn(contact.skills, id))) throw new Error('仍有联系人配置了此技能，请先移除关联。')
    const directory = join(this.packages, skill.directory)
    if (existsSync(directory)) this.directory(skill)
    state.skills = state.skills.filter(item => item.id !== id)
    this.write(state)
    rmSync(directory, { recursive: true, force: true })
  }
}
