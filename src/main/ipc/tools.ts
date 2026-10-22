import { syncSkillToolPolicy } from '../skills'
import { SKILL_TOOLS } from '../skills/tools'
import { BrowserWindow } from 'electron'
import { capabilityRegistry } from '../capabilities/registry'
import { getRegisteredTool, getToolDefinitions } from '../tools/registry'
import { type ToolCatalogItem } from '../../shared/tools'
import { getConfig, setState } from '../database'
import { ipcMain } from 'electron'
import { registerDomain } from './registration'
import { isToolEnabled } from '../chat/tool-policy'

export function registerToolsHandlers(mainWindow: BrowserWindow) {
  return registerDomain(ipcMain, ipc => {  
  
    ipc.handle('tools:list', (): ToolCatalogItem[] =>
      getToolDefinitions().map((tool) => ({ ...tool, enabled: isToolEnabled(tool.name) })))

    ipc.handle('tools:set-enabled', (_event, name: string, enabled: boolean): ToolCatalogItem[] => {
      if (typeof name !== 'string' || !/^[a-z][a-z0-9_]{1,63}$/.test(name) || typeof enabled !== 'boolean') {
        throw new Error('Invalid tool setting')
      }
      if (!getRegisteredTool(name)) throw new Error('工具不存在。')
      setState(`tool:${name}:enabled`, enabled ? 'true' : 'false')
      if (SKILL_TOOLS.some(tool => tool.name === name)) syncSkillToolPolicy()
      return getToolDefinitions().map((tool) => ({ ...tool, enabled: isToolEnabled(tool.name) }))
    })

    ipc.handle('capabilities:list', () => capabilityRegistry.list(getConfig()))
  })
}
