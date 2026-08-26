import { ipcMain } from 'electron'
import { PluginDefinition, PluginInfo, PluginContext, PluginMessageData } from './types'
import { getState, setState } from '../database'
import { bbtalkPlugin } from './bbtalk'

/** 已注册插件列表 */
const PLUGINS: PluginDefinition[] = [bbtalkPlugin]

class PluginRegistry {
  private plugins: Map<string, PluginDefinition> = new Map()
  private contexts: Map<string, PluginContext> = new Map()

  /** 同步注册插件和 IPC 通道（在 app 启动时立即调用） */
  register(): void {
    // 检查命令冲突
    this.checkCommandConflicts()

    // 注册插件并创建上下文
    for (const plugin of PLUGINS) {
      const context = this.createContext(plugin.id)
      this.contexts.set(plugin.id, context)
      this.plugins.set(plugin.id, plugin)
    }

    // 自动注册 IPC 通道
    this.registerIpcChannels()
  }

  /** 异步初始化插件（init 可能涉及网络请求等） */
  async initializePlugins(): Promise<void> {
    for (const plugin of PLUGINS) {
      if (plugin.init) {
        try {
          await plugin.init()
        } catch (err) {
          console.error(`[Plugin] ${plugin.id} init failed:`, err)
        }
      }
    }
  }

  /** 获取所有插件 */
  getPlugins(): PluginDefinition[] {
    return Array.from(this.plugins.values())
  }

  /** 按 ID 查找插件 */
  getPlugin(id: string): PluginDefinition | undefined {
    return this.plugins.get(id)
  }

  /** 获取插件元数据列表（安全传递给 Renderer） */
  getPluginInfos(): PluginInfo[] {
    return this.getPlugins().map((p) => ({
      id: p.id,
      command: p.command,
      name: p.name,
      description: p.description,
      icon: getState(`plugin:${p.id}:customIcon`) || p.icon,
      inputPlaceholder: p.inputPlaceholder,
      requiresContent: p.requiresContent,
      feedToPet: p.feedToPet,
      hasAuth: !!p.authMethods && p.authMethods.length > 0,
      authMethods: p.authMethods
    }))
  }

  private checkCommandConflicts(): void {
    const commands = new Map<string, string>()
    for (const plugin of PLUGINS) {
      if (commands.has(plugin.command)) {
        throw new Error(
          `[Plugin] Command conflict: "/${plugin.command}" is registered by both "${commands.get(plugin.command)}" and "${plugin.id}"`
        )
      }
      commands.set(plugin.command, plugin.id)
    }
  }

  private createContext(pluginId: string): PluginContext {
    return {
      getState: (key: string) => getState(`plugin:${pluginId}:${key}`),
      setState: (key: string, value: string) => setState(`plugin:${pluginId}:${key}`, value)
    }
  }

  private registerIpcChannels(): void {
    for (const plugin of this.getPlugins()) {
      // execute 通道（所有插件必有）
      ipcMain.handle(`plugin:${plugin.id}:execute`, async (_event, content: string) => {
        return this.executePlugin(plugin, content)
      })

      // login 通道（可选）
      if (plugin.login) {
        ipcMain.handle(
          `plugin:${plugin.id}:login`,
          async (_event, credentials: Record<string, string>) => {
            return plugin.login!(credentials)
          }
        )
      }

      // logout 通道（可选）
      if (plugin.logout) {
        ipcMain.handle(`plugin:${plugin.id}:logout`, async () => {
          return plugin.logout!()
        })
      }

      // isAuthenticated 通道（可选）
      if (plugin.isAuthenticated) {
        ipcMain.handle(`plugin:${plugin.id}:is-authenticated`, async () => {
          return plugin.isAuthenticated!()
        })
      }
    }

    // 全局：获取插件列表
    ipcMain.handle('plugin:get-plugins', async () => {
      return this.getPluginInfos()
    })
  }

  private async executePlugin(plugin: PluginDefinition, content: string): Promise<PluginMessageData> {
    // 认证前检查
    if (plugin.authMethods && plugin.authMethods.length > 0 && plugin.isAuthenticated && !plugin.isAuthenticated()) {
      return {
        pluginId: plugin.id,
        pluginName: plugin.name,
        pluginIcon: plugin.icon,
        ok: false,
        message: `请先在设置中登录 ${plugin.name}`,
        inputContent: content
      }
    }

    // 内容必填检查
    if (plugin.requiresContent && !content.trim()) {
      return {
        pluginId: plugin.id,
        pluginName: plugin.name,
        pluginIcon: plugin.icon,
        ok: false,
        message: `请输入内容：/${plugin.command} ${plugin.description}`,
        inputContent: content
      }
    }

    // 执行插件
    try {
      const result = await plugin.execute(content)
      return {
        pluginId: plugin.id,
        pluginName: plugin.name,
        pluginIcon: plugin.icon,
        ok: true,
        message: result.message,
        inputContent: content,
        detail: result.detail,
        actions: result.actions
      }
    } catch (err: any) {
      return {
        pluginId: plugin.id,
        pluginName: plugin.name,
        pluginIcon: plugin.icon,
        ok: false,
        message: `插件执行出错：${err.message || err}`,
        inputContent: content
      }
    }
  }
}

export const pluginRegistry = new PluginRegistry()
