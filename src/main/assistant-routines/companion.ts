import { createHash } from 'node:crypto'
import { contactTaskHref } from '../../shared/contact-links'
import { TOPIC_STATUS } from '../../shared/agents'
import type { readContactsForAssistant } from './index'

type Evidence = Awaited<ReturnType<typeof readContactsForAssistant>>
export type CompanionKind = 'greeting' | 'return'
export interface CompanionFact {
  key: string; hash: string; characterId: string; name: string; topicId: string; title: string
  status: string; judgement: string; reason: string; nextStep: string
  cards?: { id: string; version: string; cardLink: string }[]
  runStatus?: string; question?: string; error?: string
}
interface Pending { receipt: string; kind: CompanionKind; content: string; hashes: Record<string, string>; checkedAt?: string }
interface Checkpoint { hashes: Record<string, string>; checkedAt?: string; pending?: Pending }
interface Dependencies {
  read(): string | undefined | null
  write(value: string): void
  enabled(kind: CompanionKind): boolean
  allowed(): boolean
  inspect(signal: AbortSignal): Promise<Evidence>
  summarize(facts: CompanionFact[], signal: AbortSignal): Promise<string>
  deliver(pending: Pending): void
  delivered(receipt: string): boolean
}
const escape = (s: string) => s.replace(/[\\[\]()*_`<>#]/g, '\\$&').replace(/[\r\n]+/g, ' ')
const priority = (f: CompanionFact) => f.runStatus === 'waiting' ? 3 : f.runStatus === 'failed' || f.status === 'paused' ? 2 : 1

export function companionFacts(evidence: Evidence): CompanionFact[] {
  return evidence.contacts.flatMap(contact => (contact.topics ?? []).map(topic => {
    const run = contact.runs?.find(r => r.topicId === topic.id)
    const cards = (contact.pendingInteractions ?? []).filter(item => item.topicId === topic.id).map(item => ({ id: item.id, version: item.version, cardLink: item.cardLink }))
    const detail = { cards, revision: topic.revision, title: topic.title, status: topic.status, judgement: topic.judgement,
      reason: topic.reason, nextStep: topic.nextStep, runStatus: run?.status,
      question: run?.status === 'waiting' ? run.question : undefined,
      error: run?.status === 'failed' ? run.error : undefined }
    return { ...detail, key: JSON.stringify([contact.id, topic.id]),
      hash: createHash('sha256').update(JSON.stringify(detail)).digest('hex'),
      characterId: contact.id, name: contact.name, topicId: topic.id }
  })).sort((a, b) => priority(b) - priority(a))
}

/** One durable outbox and shared baseline for greetings and returns. */
export class CompanionBriefing {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private deps: Dependencies) {}
  send(kind: CompanionKind, receipt: string): Promise<void> {
    const work = this.queue.then(() => this.run(kind, receipt))
    this.queue = work.catch(() => {})
    return work
  }
  retryPending(): Promise<void> {
    const work = this.queue.then(async () => { await this.restore(this.load()) })
    this.queue = work.catch(() => {})
    return work
  }
  private load(): Checkpoint {
    const raw = this.deps.read()
    if (!raw) return { hashes: {} }
    const value = JSON.parse(raw) as Checkpoint
    if (!value || !value.hashes || typeof value.hashes !== 'object' || Array.isArray(value.hashes)
      || Object.values(value.hashes).some(v => typeof v !== 'string')
      || value.pending && (typeof value.pending.content !== 'string' || !value.pending.hashes
        || !['greeting', 'return'].includes(value.pending.kind) || typeof value.pending.receipt !== 'string')) {
      throw new Error('主动工作检查记录无法读取，原记录已保留。')
    }
    return value
  }
  private save(state: Checkpoint) { this.deps.write(JSON.stringify(state)) }
  private async current(hashes: Record<string, string>): Promise<boolean> {
    if (!Object.keys(hashes).length) return true
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const evidence = await Promise.race([this.deps.inspect(controller.signal), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('状态复核超时')) }, 10000)
      })])
      const actual = new Map(companionFacts(evidence).map(f => [f.key, f.hash]))
      return Object.entries(hashes).every(([key, hash]) => actual.get(key) === hash)
    } catch { return false }
    finally { clearTimeout(timer); controller.abort() }
  }
  private flush(state: Checkpoint) {
    const pending = state.pending!
    // appendAssistantMessage retries the underlying disk write even for an existing receipt.
    this.deps.deliver(pending)
    const next = { hashes: { ...state.hashes, ...pending.hashes }, checkedAt: pending.checkedAt }
    this.save(next)
    return next
  }
  private async restore(state: Checkpoint): Promise<Checkpoint> {
    if (!state.pending) return state
    const delivered = this.deps.delivered(state.pending.receipt)
    const current = delivered || this.deps.enabled(state.pending.kind) && this.deps.allowed() && await this.current(state.pending.hashes)
    if (delivered || current && this.deps.enabled(state.pending.kind) && this.deps.allowed()) return this.flush(state)
    delete state.pending
    this.save(state)
    return state
  }
  private async run(kind: CompanionKind, receipt: string) {
    let state: Checkpoint
    try { state = this.load() }
    catch {
      if (this.deps.enabled(kind) && !this.deps.delivered(receipt)) this.deps.deliver({ receipt, kind, hashes: {},
        content: '这次没有检查工作：上次工作检查记录无法读取，原记录已保留，需要修复后继续。' })
      return
    }
    state = await this.restore(state)
    if (this.deps.delivered(receipt) || !this.deps.enabled(kind)) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const bounded = <T>(operation: Promise<T>): Promise<T> => Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('工作检查超时')) }, 45_000)
    })]).finally(() => clearTimeout(timer))
    const opening = kind === 'return' ? '欢迎回来。' : new Date().getHours() < 12 ? '早上好。' : '你好。'
    let content = opening, hashes: Record<string, string> = {}, checkedAt = state.checkedAt
    const wasAllowed = this.deps.allowed()
    try {
      if (!wasAllowed) content += '这次没有检查工作：联系人状态工具或 AI 工具已关闭，可在能力设置中开启。'
      else {
        await bounded((async () => {
          const evidence = await this.deps.inspect(controller.signal)
          controller.signal.throwIfAborted()
          checkedAt = evidence.checkedAt
          const facts = companionFacts(evidence)
          const changed = facts.filter(f => state.hashes[f.key] !== f.hash)
          // First inspection should not rediscover all completed historical work.
          const relevant = changed.filter(f => state.checkedAt || !['completed', 'abandoned'].includes(f.status))
          const selected = relevant.slice(0, 8)
          const unavailable = evidence.contacts.filter(c => c.unavailable).map(c => c.name)
          const omitted = evidence.contacts.reduce((sum, c) => sum + (c.omittedTopics ?? 0), 0)
          if (unavailable.length && unavailable.length === evidence.contacts.length) {
            content = `${opening}这次联系人状态全部读取失败，无法判断最新进展；下次检查会重试。`
            checkedAt = state.checkedAt
            return
          }
          content += state.checkedAt ? '我检查了联系人工作。' : '我查看了当前联系人工作；以下是现状，不代表今天新增。'
          if (selected.length) {
            try {
              const summary = await this.deps.summarize(selected, controller.signal)
              controller.signal.throwIfAborted()
              if (!summary.trim()) throw new Error('empty summary')
              // Model text never supplies task links; checked IDs below are the only navigation.
              content += `\n\n${escape(summary.trim().slice(0, 1600))}`
            } catch {
              controller.signal.throwIfAborted()
              content += '\n\n这次模型整理失败，下面直接列出已读取的任务状态。'
            }
            content += '\n\n' + selected.map(f => {
              if (f.cards?.length) return f.cards.map(card => `[${escape(f.name)} · 待处理](${card.cardLink})`).join('\n')
              const label = f.runStatus === 'waiting' ? `等你回复：${f.question || '请打开任务查看问题'}`
                : f.runStatus === 'failed' ? '这次未能完成，请打开任务查看原因'
                  : TOPIC_STATUS[f.status as keyof typeof TOPIC_STATUS] ?? '状态暂时无法确认'
              return `- [${escape(f.name)} · ${escape(f.title)}](${contactTaskHref(f.characterId, f.topicId)})：${escape(label.slice(0, 420))}`
            }).join('\n')
            hashes = Object.fromEntries(selected.map(f => [f.key, f.hash]))
          } else if (!facts.length) content += unavailable.length ? '已读取的联系人没有任务。' : '目前没有联系人任务。'
          else {
            const waiting = facts.filter(f => f.runStatus === 'waiting' || f.runStatus === 'failed' || f.status === 'paused').length
            content += state.checkedAt ? '已读取的任务没有新的变化。' : '目前只有已结束或已放弃的历史任务。'
            if (waiting) content += `仍有 ${waiting} 项待回复、失败或暂停的任务，详情沿用上次汇报。`
          }
          if (relevant.length > selected.length || omitted) content += `\n\n另有 ${relevant.length - selected.length + omitted} 项未在本次展开，可到联系人任务查看。`
          if (unavailable.length) content += `\n\n只完成了部分检查：${unavailable.map(escape).join('、')}的状态读取失败，不能判断是否有进展。`
          // Baseline old closed tasks without presenting them as new achievements.
          if (!state.checkedAt) for (const f of changed.filter(f => ['completed', 'abandoned'].includes(f.status))) hashes[f.key] = f.hash
        })())
      }
    } catch {
      controller.abort()
      hashes = {}
      checkedAt = state.checkedAt
      content = `${opening}这次工作检查失败或超时，暂时无法确认最新进展；下次检查会重试。`
    } finally { clearTimeout(timer) }
    if (!this.deps.enabled(kind) || wasAllowed && !this.deps.allowed()) return
    if (!await this.current(hashes)) {
      content = `${opening}工作状态在整理期间发生变化或暂时无法复核，这次没有发送旧进展；下次检查会重试。`
      hashes = {}
      checkedAt = state.checkedAt
    }
    if (!this.deps.enabled(kind) || wasAllowed && !this.deps.allowed()) return
    state.pending = { receipt, kind, content, hashes, checkedAt }
    this.save(state) // Generation is durable before delivery; no second model call on retry.
    this.flush(state)
  }
}
