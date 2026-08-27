import { pluginRegistry } from '../plugins/registry'
import { registerTool } from './registry'

export function toPluginToolName(pluginId: string): string {
  const normalized = pluginId.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+/, '')
  return `plugin_${normalized || 'tool'}`.slice(0, 64)
}

export function registerPluginTools(): void {
  for (const plugin of pluginRegistry.getPlugins()) {
    registerTool({
      name: toPluginToolName(plugin.id),
      displayName: `运行 ${plugin.name}`,
      description: `${plugin.description}。此工具会调用 ${plugin.name} 插件执行外部操作。`,
      inputSchema: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: plugin.inputPlaceholder || plugin.description,
            maxLength: 20_000
          }
        },
        required: plugin.requiresContent === false ? [] : ['content'],
        additionalProperties: false
      },
      risk: 'write',
      requiresConfirmation: true,
      source: 'plugin',
      async execute(arguments_) {
        const content = typeof arguments_.content === 'string' ? arguments_.content : ''
        const result = await pluginRegistry.executeById(plugin.id, content)
        if (!result.ok) throw new Error(result.message)
        return {
          content: result.detail ? `${result.message}\n\n${result.detail}` : result.message,
          summary: result.message
        }
      }
    })
  }
}
