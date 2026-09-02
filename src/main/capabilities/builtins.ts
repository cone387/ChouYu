import path from 'path'
import { capabilityRegistry } from './registry'
import { SQLiteMemoryProvider } from '../memory/sqlite-provider'
import { OpenAIEmbeddingClient } from '../memory/embedding-client'
import { Mem0MemoryProvider } from '../memory/mem0-provider'

let registered = false

export function registerBuiltInCapabilities(): void {
  if (registered) return
  registered = true
  capabilityRegistry.register({
    id: 'chouyu-sqlite',
    kind: 'memory-engine',
    name: 'ChouYu SQLite',
    description: '默认本地记忆引擎，支持关键词检索、冲突、历史和生命周期。',
    networkAccess: false,
    sendsMemoryData: false,
    requiresConfiguration: false,
    create: ({ userDataPath }) => new SQLiteMemoryProvider(path.join(userDataPath, 'chouyu-memory.db'))
  })
  capabilityRegistry.register({
    id: 'mem0-platform-engine',
    kind: 'memory-engine',
    name: 'Mem0 Platform',
    description: '作为唯一主记忆引擎使用 Mem0 Platform；本地 SQLite 仅作缓存。',
    networkAccess: true,
    sendsMemoryData: true,
    requiresConfiguration: true,
    create: ({ userDataPath, config }) => {
      if (!config) throw new Error('Mem0 主记忆引擎缺少配置')
      return new Mem0MemoryProvider(path.join(userDataPath, 'chouyu-memory.db'), config, 'platform')
    }
  })
  capabilityRegistry.register({
    id: 'mem0-self-hosted-engine',
    kind: 'memory-engine',
    name: 'Mem0 Self-hosted',
    description: '作为唯一主记忆引擎使用自托管 Mem0；本地 SQLite 仅作缓存。',
    networkAccess: true,
    sendsMemoryData: true,
    requiresConfiguration: true,
    create: ({ userDataPath, config }) => {
      if (!config) throw new Error('Mem0 主记忆引擎缺少配置')
      return new Mem0MemoryProvider(path.join(userDataPath, 'chouyu-memory.db'), config, 'self-hosted')
    }
  })
  capabilityRegistry.register({
    id: 'openai-compatible',
    kind: 'embedding',
    name: 'OpenAI-compatible Embedding',
    description: '调用兼容 /embeddings 的在线或本地服务；失败时记忆检索自动退回关键词。',
    networkAccess: true,
    sendsMemoryData: true,
    requiresConfiguration: true,
    create: (config) => new OpenAIEmbeddingClient({
      baseUrl: config.embeddingBaseUrl || config.baseUrl,
      apiKey: config.embeddingApiKey || config.apiKey,
      model: config.embeddingModel
    })
  })
}
