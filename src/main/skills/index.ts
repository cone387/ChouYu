import { app, ipcMain, BrowserWindow, type IpcMain } from 'electron'
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
const catalog = new SkillCatalog()
export function contactSkillMarket() { return hub ??= new SkillHub(contactSkillLibrary().root, contactSkillLibrary()) }
export function findContactSkills(query: string) { return catalog.browse({ keyword: query }) }
export async function installContactSkill(id: string) {
  const market = contactSkillMarket(), signal = AbortSignal.timeout(720000)
  if (!(await market.status()).ready) await market.setup(signal)
  return market.install(id, signal)
}
export function contactSkillRunner() { return runner ??= new SkillRunner(contactSkillLibrary()) }
export function syncSkillToolPolicy() {
  contactSkillRunner().updateToolPolicy(getConfig().aiToolsEnabled, SKILL_TOOLS.filter(tool => getState(`tool:${tool.name}:enabled`) === 'false').map(tool => tool.name))
}
export function contactSkillLibrary() {
  return library ??= new SkillLibrary(join(app.getPath('userData'), 'contact-skills'))
}
/** Shared by the settings page, chat tools and interaction actions. */
export function configureContactSkill(owner: string, id: string, action: SkillAction, revision: number) {
  if (owner === ASSISTANT_CHARACTER_ID || !getCharacter(owner)) throw new Error('联系人不存在。')
  const result = contactSkillLibrary().configure(owner, id, action, revision)
  if (['disable', 'disable_scripts', 'remove'].includes(action)) contactSkillRunner().cancel(owner, id)
  for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('agents:changed', owner)
  return result
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
export function registerSkillHandlers(window: BrowserWindow, ipc: Pick<IpcMain, 'handle'> = ipcMain): () => void {
  syncSkillToolPolicy()
  for (const definition of SKILL_TOOLS) if (!getRegisteredTool(definition.name)) registerTool({ ...definition, execute: () => { throw new Error('技能工具只能在具体联系人的运行上下文中使用。') } })
  const operations = new Map<number, AbortController>()
  const market = contactSkillMarket
  const assertOwner = (id: unknown): string => {
    if (typeof id !== 'string' || id === ASSISTANT_CHARACTER_ID || !getCharacter(id)) throw new Error('联系人不存在。')
    return id
  }
  const handlers: Record<string, (...args: any[]) => unknown> = {
    'runtime-status': id => contactSkillRunner().statusForSkill(id),
    'work-files': owner => contactSkillRunner().workFiles(assertOwner(owner)),
    logs: (owner, id) => contactSkillRunner().logs(assertOwner(owner), id),
    browse: query => catalog.browse(query),
    categories: () => catalog.categories(),
    status: () => market().status(),
    list: id => contactSkillLibrary().list(assertOwner(id)),
    detail: id => contactSkillLibrary().detail(id),
    configure: (owner, id, action: SkillAction, revision) => configureContactSkill(assertOwner(owner), id, action, revision),
    uninstall: id => contactSkillLibrary().uninstall(id)
  }
  for (const [method, handler] of Object.entries(handlers)) ipc.handle(`skills:${method}`, (event, ...args) => {
    if (event.sender !== window.webContents) throw new Error('技能操作来源无效。')
    return handler(...args)
  })
  for (const method of ['setup', 'search', 'install', 'prepare-runtime', 'prepare-dependencies'] as const) ipc.handle(`skills:${method}`, async (event, input, id) => {
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
  ipc.handle('skills:cancel', event => {
    if (event.sender !== window.webContents) throw new Error('技能操作来源无效。')
    operations.get(event.sender.id)?.abort()
  })
  const cancel = () => { for (const controller of operations.values()) controller.abort(); runner?.cancel() }
  app.once('before-quit', cancel)
  return () => { app.removeListener('before-quit', cancel); cancel() }
}
