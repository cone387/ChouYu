import type { HarnessEngine } from '../../shared/harness'
import type { HarnessInput, HarnessModule } from './contracts'

export class HarnessRegistry {
  private modules = new Map<HarnessEngine, HarnessModule>()
  constructor(modules: HarnessModule[]) {
    for (const module of modules) {
      if (this.modules.has(module.id)) throw new Error(`执行模块重复注册：${module.id}`)
      this.modules.set(module.id, module)
    }
  }
  all(): readonly HarnessModule[] { return [...this.modules.values()] }
  get(engine: HarnessEngine): HarnessModule {
    const module = this.modules.get(engine)
    if (!module) throw new Error(`执行模块 ${engine} 尚不可用，本次未执行。`)
    return module
  }
  prepare(engine: HarnessEngine, input: HarnessInput, platform: NodeJS.Platform): HarnessInput {
    const { capabilities: caps, label } = this.get(engine)
    if (caps.platforms !== 'all' && !caps.platforms.includes(platform)) throw new Error(`${label} 暂不支持此平台，本次未执行。`)
    if (!caps.scenarios.includes('chat')) throw new Error(`${label} 不支持普通聊天。`)
    if (!caps.images && input.messages.some(message => Boolean(message.imageUrl))) throw new Error(`${label} 暂不支持图片，本次未执行。`)
    if (!caps.systemHistory && input.messages.some(message => message.role === 'system')) throw new Error(`${label} 不支持额外的系统历史消息。`)
    const host = input.tools
    if (!host) return { ...input }
    const definitions = host.definitions.filter(tool => caps.tools === 'host' || caps.tools.includes(tool.name))
    const allowed = new Set(definitions.map(tool => tool.name))
    return { ...input, tools: {
      definitions,
      subscribe: host.subscribe?.bind(host),
      execute: async call => {
        input.signal.throwIfAborted()
        if (!allowed.has(call.name)) throw new Error(`工具不在本次授权目录内：${call.name}`)
        await input.assertContext()
        input.signal.throwIfAborted()
        return host.execute(call)
      }
    } }
  }
}
