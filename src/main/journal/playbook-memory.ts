import { createHash, randomUUID } from 'crypto'
import type { AppConfig } from '../../shared/config'
import { containsSecret, normalizeMemoryKey, type MemoryCandidateInput, type MemoryRecord } from '../../shared/memory'
import type { JournalPlaybookEntry, JournalPlaybookMemoryInput, JournalPlaybookMemoryPlan } from '../../shared/journal-playbook'

const signature = (config: AppConfig) => createHash('sha256').update(JSON.stringify(config)).digest('hex')
const endpoint = (value: string) => {
  try { const url = new URL(value); return `${url.origin}${url.pathname}` } catch { return '地址未配置' }
}
export class JournalPlaybookMemory {
  private plans = new Map<string, { owner: number; input: JournalPlaybookMemoryInput; config: string; expiresAt: number }>()
  constructor(private entries: () => Promise<JournalPlaybookEntry[]>, private config: () => AppConfig, private write: (candidate: MemoryCandidateInput) => Promise<MemoryRecord>, private now = Date.now) {}
  private async entry(input: JournalPlaybookMemoryInput) {
    const entry = (await this.entries()).find(value => value.id === input.id)
    if (!entry || entry.revision !== input.revision) throw new Error('手册已修改或删除，请刷新后重新预览。')
    if (entry.status !== 'resolved') throw new Error('请先核对解决办法，并将手册标记为已解决。')
    return entry
  }
  async prepare(owner: number, raw: JournalPlaybookMemoryInput): Promise<JournalPlaybookMemoryPlan> {
    if (!raw || typeof raw.id !== 'string' || !Number.isSafeInteger(raw.revision) || typeof raw.content !== 'string' || !raw.content.trim() || raw.content.length > 500 || typeof raw.sensitive !== 'boolean' || !normalizeMemoryKey(raw.content)) throw new Error('记忆摘要需为 1–500 字，请手动整理后预览。')
    if (containsSecret(raw.content)) throw new Error('检测到密码、Token 或密钥，已阻止保存。')
    const input = { ...raw, content: raw.content.trim() }
    await this.entry(input)
    const config = this.config()
    if (!config.memoryEnabled) throw new Error('请先在设置中启用长期记忆。')
    const remote = ['mem0-platform-engine', 'mem0-self-hosted-engine'].includes(config.memoryEngineProvider)
    if (!remote && config.memoryEngineProvider !== 'chouyu-sqlite') throw new Error('当前记忆引擎暂不支持手册确认写入。')
    for (const [key, plan] of this.plans) if (plan.expiresAt <= this.now() || plan.owner === owner) this.plans.delete(key)
    while (this.plans.size >= 20) this.plans.delete(this.plans.keys().next().value!)
    const token = randomUUID(), expiresAt = this.now() + 10 * 60_000
    this.plans.set(token, { owner, input, config: signature(config), expiresAt })
    return { token, content: input.content, sensitive: input.sensitive, expiresAt,
      destination: remote ? `Mem0（${endpoint(config.memorySyncBaseUrl)}），用户：${config.memorySyncUserId || '未配置'}` : '本机长期记忆库',
      indexing: remote ? '检索索引由 Mem0 管理。' : config.embeddingEnabled && config.embeddingProvider !== 'none' ? `保存后会向已配置的 Embedding 服务发送这段摘要：${endpoint(config.embeddingBaseUrl || config.baseUrl)}（${config.embeddingModel}）。索引失败不撤销已保存的记忆。` : '未启用向量索引。' }
  }
  async confirm(owner: number, token: string): Promise<MemoryRecord> {
    const plan = this.plans.get(token)
    if (!plan || plan.owner !== owner || plan.expiresAt <= this.now()) throw new Error('确认预览已失效，请重新预览。')
    this.plans.delete(token)
    await this.entry(plan.input)
    if (signature(this.config()) !== plan.config) throw new Error('配置已变化，请重新预览保存位置。')
    return this.write({ type: 'workflow', content: plan.input.content, importance: 0.75, confidence: 1, sensitivity: plan.input.sensitive ? 'sensitive' : 'normal', sourceSessionId: 'journal-playbook', sourceMessageId: plan.input.id })
  }
}
