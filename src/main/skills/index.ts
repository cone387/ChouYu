import { app, ipcMain, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { getCharacter, getConfig, getState } from '../database'
import { ASSISTANT_CHARACTER_ID } from '../../shared/characters'
import type { SkillAction, SkillSnapshot } from '../../shared/skills'
import { SkillLibrary } from './library'
import { SkillHub } from './skillhub'
import { SkillCatalog } from './catalog'
import { SkillRunner } from './runner'
import { SKILL_TOOLS } from './tools'
import { getRegisteredTool, registerTool } from '../tools/registry'

let library: SkillLibrary | undefined, hub: SkillHub | undefined
let runner: SkillRunner | undefined
export function contactSkillRunner() { return runner ??= new SkillRunner(contactSkillLibrary()) }
export function syncSkillToolPolicy() {
  contactSkillRunner().updateToolPolicy(getConfig().aiToolsEnabled, SKILL_TOOLS.filter(tool => getState(`tool:${tool.name}:enabled`) === 'false').map(tool => tool.name))
}
export function contactSkillLibrary() {
  return library ??= new SkillLibrary(join(app.getPath('userData'), 'contact-skills'))
}
export function getContactSkills(characterId: string): SkillSnapshot {
  try { return contactSkillLibrary().snapshot(characterId) }
  catch (error) { return { entries: [], instruction: '', error: error instanceof Error ? error.message : '联系人技能读取失败。' } }
}
export function contactSkillInstruction(characterId: string): string {
  const snapshot = getContactSkills(characterId)
  if (snapshot.error) throw new Error(snapshot.error)
  return snapshot.instruction
}
export function registerSkillHandlers(window: BrowserWindow) {
  syncSkillToolPolicy()
  for (const definition of SKILL_TOOLS) if (!getRegisteredTool(definition.name)) registerTool({ ...definition, execute: () => { throw new Error('技能工具只能在具体联系人的运行上下文中使用。') } })
  const catalog = new SkillCatalog()
  const operations = new Map<number, AbortController>()
  const market = () => hub ??= new SkillHub(contactSkillLibrary().root, contactSkillLibrary())
  const assertOwner = (id: unknown): string => {
    if (typeof id !== 'string' || id === ASSISTANT_CHARACTER_ID || !getCharacter(id)) throw new Error('联系人不存在。')
    return id
  }
  const handlers: Record<string, (...args: any[]) => unknown> = {
    'runtime-status': () => contactSkillRunner().status(),
    logs: (owner, id) => contactSkillRunner().logs(assertOwner(owner), id),
    browse: query => catalog.browse(query),
    categories: () => catalog.categories(),
    status: () => market().status(),
    list: id => contactSkillLibrary().list(assertOwner(id)),
    detail: id => contactSkillLibrary().detail(id),
    configure: (owner, id, action: SkillAction, revision) => {
      const result = contactSkillLibrary().configure(assertOwner(owner), id, action, revision)
      if (['disable', 'disable_scripts', 'remove'].includes(action)) contactSkillRunner().cancel(owner, id)
      return result
    },
    uninstall: id => contactSkillLibrary().uninstall(id)
  }
  for (const [method, handler] of Object.entries(handlers)) ipcMain.handle(`skills:${method}`, (event, ...args) => {
    if (event.sender !== window.webContents) throw new Error('技能操作来源无效。')
    return handler(...args)
  })
  for (const method of ['setup', 'search', 'install', 'prepare-runtime', 'prepare-dependencies'] as const) ipcMain.handle(`skills:${method}`, async (event, input, id) => {
    if (event.sender !== window.webContents) throw new Error('技能操作来源无效。')
    if (operations.has(event.sender.id)) throw new Error('请等待当前技能操作完成，或先取消。')
    const controller = new AbortController(), senderId = event.sender.id
    operations.set(senderId, controller)
    const abort = () => controller.abort()
    event.sender.once('destroyed', abort)
    try {
      if (method === 'prepare-runtime') return await contactSkillRunner().prepare(controller.signal)
      if (method === 'prepare-dependencies') return await contactSkillRunner().prepareDependencies(assertOwner(input), id, controller.signal)
      return method === 'setup' ? await market().setup(controller.signal) : await market()[method](input, controller.signal)
    }
    finally { operations.delete(senderId); if (!event.sender.isDestroyed()) event.sender.removeListener('destroyed', abort) }
  })
  ipcMain.handle('skills:cancel', event => {
    if (event.sender !== window.webContents) throw new Error('技能操作来源无效。')
    operations.get(event.sender.id)?.abort()
  })
  app.once('before-quit', () => { for (const controller of operations.values()) controller.abort(); runner?.cancel() })
}
