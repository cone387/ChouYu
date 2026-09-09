import { SQLiteMemoryProvider } from '../memory/sqlite-provider'

export function runMemoryPaginationSmoke(): void {
  const provider = new SQLiteMemoryProvider(':memory:')
  provider.initialize()
  try {
    const oldest = provider.createActive({ type: 'project', content: 'ÄLTER 旧记忆含字面_%', importance: 1, confidence: 1, sensitivity: 'normal' })
    for (let index = 0; index < 525; index++) provider.createActive({ type: 'fact', content: `分页合成记录 ${index}`, importance: .5, confidence: 1, sensitivity: 'normal' })
    const all: string[] = []
    for (let offset = 0; offset < 526; offset += 50) {
      const result = provider.listPage({ status: 'active', limit: 50, offset })
      if (result.total !== 526) throw new Error('Memory pagination total mismatch')
      all.push(...result.items.map(item => item.id))
    }
    if (all.length !== 526 || new Set(all).size !== 526 || !all.includes(oldest.id)) throw new Error('Memory pagination lost or duplicated records')
    for (const query of ['älter', '_%']) {
      const result = provider.listPage({ query, limit: 50 })
      if (result.total !== 1 || result.items[0].id !== oldest.id) throw new Error('Memory filtering happened after truncation or changed literal/Unicode matching')
    }
    const typed = provider.listPage({ type: 'project', limit: 50 })
    if (typed.total !== 1 || typed.typeCounts.fact !== 525 || typed.typeCounts.project !== 1) throw new Error('Memory type totals were limited to current page/type')
    if (provider.listPage({ sortBy: 'importance', limit: 1 }).items[0].id !== oldest.id) throw new Error('Memory sort was applied after pagination')
    for (const id of all.slice(500)) provider.delete(id)
    const clamped = provider.listPage({ limit: 50, offset: 500 })
    if (clamped.offset !== 450 || clamped.total !== 500 || clamped.items.length !== 50) throw new Error('Memory deletion left an empty out-of-range page')
    for (let index = 0; index < 1601; index++) provider.createCandidate({ type: 'workflow', content: `完整导出待处理合成记录 ${index}`, importance: .5, confidence: 1, sensitivity: 'normal' })
    const exported = provider.exportAll()
    if (exported.length !== 2101 || exported.filter(item => item.status === 'active').length !== 500 || exported.filter(item => item.status === 'pending').length !== 1601) throw new Error('Local export omitted active or pending records beyond the page ceiling')
    console.log('CHOUYU_MEMORY_PAGINATION_SMOKE_PASSED pagination/filter/sort/deletion and complete local export of 2101 active/pending records')
  } finally { provider.close() }
}
