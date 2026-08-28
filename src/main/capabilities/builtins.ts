import path from 'path'
import { capabilityRegistry } from './registry'
import { SQLiteMemoryProvider } from '../memory/sqlite-provider'
import { OpenAIEmbeddingClient } from '../memory/embedding-client'
import { Mem0MemorySyncAdapter } from '../memory/sync/mem0-adapter'

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
  capabilityRegistry.register({
    id: 'mem0-platform',
    kind: 'memory-sync',
    name: 'Mem0 Platform',
    description: '显式上传或预览拉取 Mem0 托管平台中的记忆。',
    networkAccess: true,
    sendsMemoryData: true,
    requiresConfiguration: true,
    create: (config) => new Mem0MemorySyncAdapter({ baseUrl: config.memorySyncBaseUrl, apiKey: config.memorySyncApiKey, userId: config.memorySyncUserId, mode: 'platform' })
  })
  capabilityRegistry.register({
    id: 'mem0-self-hosted',
    kind: 'memory-sync',
    name: 'Mem0 Self-hosted',
    description: '连接本机或自托管 Mem0 Server，使用 X-API-Key；允许本地开发关闭鉴权。',
    networkAccess: true,
    sendsMemoryData: true,
    requiresConfiguration: true,
    create: (config) => new Mem0MemorySyncAdapter({ baseUrl: config.memorySyncBaseUrl, apiKey: config.memorySyncApiKey, userId: config.memorySyncUserId, mode: 'self-hosted' })
  })
}
