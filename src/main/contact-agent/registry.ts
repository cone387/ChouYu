import type { ContactModuleFactory } from './contracts'

export class ModuleRegistry {
  private factories = new Map<string, ContactModuleFactory>()
  register(id: string, factory: ContactModuleFactory) {
    if (!id || this.factories.has(id)) throw new Error(`联系人模块重复或无效：${id}`)
    this.factories.set(id, factory)
  }
  resolve(ids: readonly string[]) {
    if (new Set(ids).size !== ids.length) throw new Error('联系人模块不能重复装配。')
    return ids.map(id => {
      const factory = this.factories.get(id)
      if (!factory) throw new Error(`联系人模块尚未注册：${id}`)
      return { id, factory }
    })
  }
}
