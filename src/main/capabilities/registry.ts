import type { AppConfig } from '../../shared/config'
import type { CapabilityInfo, CapabilityKind } from '../../shared/capabilities'
import type { MemoryProvider } from '../memory/provider'

export interface EmbeddingRuntime {
  embed(texts: string[], signal?: AbortSignal): Promise<number[][]>
}

interface CapabilityBase {
  id: string
  kind: CapabilityKind
  name: string
  description: string
  networkAccess: boolean
  sendsMemoryData: boolean
  requiresConfiguration: boolean
}

export interface MemoryEngineCapability extends CapabilityBase {
  kind: 'memory-engine'
  create(context: { userDataPath: string; config?: AppConfig }): MemoryProvider
}

export interface EmbeddingCapability extends CapabilityBase {
  kind: 'embedding'
  create(config: AppConfig): EmbeddingRuntime
}

type CapabilityDefinition = MemoryEngineCapability | EmbeddingCapability

class CapabilityRegistry {
  private readonly definitions = new Map<string, CapabilityDefinition>()

  register(definition: CapabilityDefinition): void {
    if (!/^[a-z0-9][a-z0-9.-]{1,79}$/.test(definition.id)) throw new Error(`Invalid capability id: ${definition.id}`)
    if (this.definitions.has(definition.id)) throw new Error(`Capability already registered: ${definition.id}`)
    this.definitions.set(definition.id, definition)
  }

  list(config: AppConfig): CapabilityInfo[] {
    return [...this.definitions.values()].map((definition) => ({
      id: definition.id,
      kind: definition.kind,
      name: definition.name,
      description: definition.description,
      installed: true,
      active: definition.kind === 'memory-engine' ? config.memoryEngineProvider === definition.id
        : definition.kind === 'embedding' ? config.embeddingEnabled && config.embeddingProvider === definition.id
          : false,
      networkAccess: definition.networkAccess,
      sendsMemoryData: definition.sendsMemoryData,
      requiresConfiguration: definition.requiresConfiguration
    }))
  }

  createMemoryEngine(id: string, context: { userDataPath: string; config?: AppConfig }): MemoryProvider {
    const definition = this.definitions.get(id)
    if (!definition || definition.kind !== 'memory-engine') throw new Error(`记忆引擎能力未安装：${id}`)
    return definition.create(context)
  }

  createEmbedding(id: string, config: AppConfig): EmbeddingRuntime {
    const definition = this.definitions.get(id)
    if (!definition || definition.kind !== 'embedding') throw new Error(`Embedding 能力未安装：${id}`)
    return definition.create(config)
  }

  clearForTests(): void {
    this.definitions.clear()
  }
}

export const capabilityRegistry = new CapabilityRegistry()
