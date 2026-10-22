import { syncSkillToolPolicy } from '../skills'
import { BrowserWindow, app } from 'electron'
import { notifyJournalConfig } from '../journal'
import { getProviderProfiles, MAX_PROVIDER_PROFILES, sanitizeConfigPatch, sanitizeProviderProfile } from '../../shared/config'
import type { ResolvedProviderProfile } from '../../shared/config'
import type { AIModelListResult } from '../../shared/ai'
import { reloadPluginHotkeys, updateMainHotkey } from '../hotkey'
import { setClipboardWatcherEnabled } from '../clipboard'
import { diagnoseProvider, fetchProviderModels } from '../ai'
import { runMemoryMaintenance, closeMemory, initializeMemory } from '../memory/service'
import { getConfig, saveConfig, listCharacters, getState, setState } from '../database'
import { ipcMain } from 'electron'
import { registerDomain } from './registration'

export function registerConfigHandlers(mainWindow: BrowserWindow) {
  return registerDomain(ipcMain, ipc => {  
  
    ipc.handle('fetch-models', async (): Promise<AIModelListResult> => {
      const config = getConfig()
      const result = await fetchProviderModels(config)
      if (result.ok && result.baseUrlAdjusted) {
        saveConfig({ baseUrl: result.baseUrl })
        mainWindow.webContents.send('config:changed', getConfig())
        notifyJournalConfig(getConfig())
      }
      return result
    })

    ipc.handle('diagnose-provider', async () => diagnoseProvider(getConfig()))

    ipc.handle('db:get-config', () => getConfig())
  
    ipc.handle('db:save-config', (_event, rawPatch) => {
      const patch = sanitizeConfigPatch(rawPatch)
      if (patch.hotkey && !updateMainHotkey(patch.hotkey)) {
        throw new Error(`快捷键“${patch.hotkey}”无效或已被其他程序占用`)
      }
      const previousMemoryEngine = getConfig().memoryEngineProvider
      saveConfig(patch)
      if (patch.aiToolsEnabled !== undefined) syncSkillToolPolicy()
      const updated = getConfig()
      // The selected memory engine is a process-level capability. Reload it as
      // soon as the setting changes so the next chat request uses the engine the
      // user just selected instead of the provider created during app startup.
      if (patch.memoryEngineProvider !== undefined && patch.memoryEngineProvider !== previousMemoryEngine) {
        closeMemory()
        initializeMemory()
      }
      if (patch.memoryMaxItems !== undefined || patch.memoryDefaultTtlDays !== undefined) runMemoryMaintenance()
      if (typeof patch.autoStart === 'boolean') {
        app.setLoginItemSettings({ openAtLogin: patch.autoStart })
      }
      if (typeof patch.clipboardWatch === 'boolean') {
        setClipboardWatcherEnabled(mainWindow, patch.clipboardWatch)
      }
      mainWindow.webContents.send('config:changed', updated)
      notifyJournalConfig(updated)
      return updated
    })
  
    ipc.handle('characters:fetch-models', async (_event, profileId: string): Promise<AIModelListResult> => {
      const profile = getProviderProfiles(getConfig()).find((item) => item.id === profileId)
      if (!profile) {
        return { ok: false, models: [], baseUrl: '', baseUrlAdjusted: false, configuredModelValid: false, errorCode: 'invalid-url', message: '供应商档案不存在。' }
      }
      // 档案级模型列表只读，不回写 baseUrl（区别于全局 fetch-models 的自动修正）。
      return fetchProviderModels({ ...getConfig(), provider: profile.provider, baseUrl: profile.baseUrl, apiKey: profile.apiKey, model: '' })
    })

    ipc.handle('provider-profiles:list', (): ResolvedProviderProfile[] => getProviderProfiles(getConfig()))
  
    ipc.handle('provider-profiles:save', (_event, rawProfile: unknown): ResolvedProviderProfile[] => {
      const profile = sanitizeProviderProfile(rawProfile)
      if (!profile) throw new Error('档案名称和 Base URL 为必填项。')
      const config = getConfig()
      const next = [...config.providerProfiles.filter((item) => item.id !== profile.id), profile]
      if (next.length > MAX_PROVIDER_PROFILES) throw new Error(`最多支持 ${MAX_PROVIDER_PROFILES} 个供应商档案。`)
      saveConfig({ providerProfiles: next })
      notifyJournalConfig(getConfig())
      return getProviderProfiles(getConfig())
    })
  
    ipc.handle('provider-profiles:delete', (_event, profileId: string): ResolvedProviderProfile[] => {
      const config = getConfig()
      if (!config.providerProfiles.some((item) => item.id === profileId)) throw new Error('档案不存在或已被删除。')
      const referencing = listCharacters().filter((character) => character.providerProfileId === profileId)
      if (referencing.length > 0) {
        throw new Error(`档案正被角色「${referencing.map((character) => character.name).join('、')}」使用，请先调整这些角色。`)
      }
      saveConfig({ providerProfiles: config.providerProfiles.filter((item) => item.id !== profileId) })
      return getProviderProfiles(getConfig())
    })
  
    ipc.handle('db:get-state', (_event, key) => {
      if (typeof key !== 'string' || key.length > 256) return null
      return getState(key)
    })
  
    ipc.handle('db:set-state', (_event, key, value) => {
      if (typeof key !== 'string' || !key || key.length > 256) throw new Error('Invalid state key')
      if (typeof value !== 'string' || value.length > 1_000_000) throw new Error('Invalid state value')
      const pluginHotkeyMatch = key.match(/^plugin:([^:]+):hotkey$/)
      const previousValue = pluginHotkeyMatch ? getState(key) ?? '' : ''
      setState(key, value)
      if (pluginHotkeyMatch) {
        const failedPluginIds = reloadPluginHotkeys(mainWindow)
        if (failedPluginIds.includes(pluginHotkeyMatch[1])) {
          setState(key, previousValue)
          reloadPluginHotkeys(mainWindow)
          throw new Error(`快捷键“${value}”无效或已被其他程序占用`)
        }
      }
    })
  })
}
