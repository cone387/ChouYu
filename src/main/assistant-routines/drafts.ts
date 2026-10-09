import { appendTaskRequestLog } from '../../shared/task-request-log'
export interface ContactTaskDraftTurn { role: 'user' | 'assistant'; text: string }
export interface ContactTaskDraft { targetKey: string; turns: ContactTaskDraftTurn[]; updatedAt: number; truncated?: boolean }
interface DraftDeps {
  read(): string | undefined | null
  write(value: string): void
  quarantine?(value: string): void
}
const MAX_DRAFTS = 20
const MAX_TURN_CHARS = 8000
/** Clarification chains live apart from routine data; corruption here never blocks tasks. */
export class ContactTaskDraftStore {
  constructor(private deps: DraftDeps) {}
  private parse(): ContactTaskDraft[] {
    const raw = this.deps.read()
    if (!raw) return []
    try {
      const value = JSON.parse(raw)
      if (!Array.isArray(value) || !value.every(d => d && typeof d.targetKey === 'string' && d.targetKey && Number.isFinite(d.updatedAt) && Array.isArray(d.turns) && d.turns.every((t: ContactTaskDraftTurn) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string'))) throw new Error('invalid')
      return value
    } catch (error) {
      this.deps.quarantine?.(raw)
      return []
    }
  }
  private save(drafts: ContactTaskDraft[]) {
    this.deps.write(JSON.stringify(drafts.slice(-MAX_DRAFTS)))
  }
  list(): ContactTaskDraft[] { return this.parse() }
  get(targetKey: string): ContactTaskDraft | undefined { return this.parse().find(d => d.targetKey === targetKey) }
  append(targetKey: string, turn: ContactTaskDraftTurn) {
    if (typeof targetKey !== 'string' || !targetKey || typeof turn.text !== 'string' || !turn.text.trim() || turn.text.length > 8000) throw new Error('草稿内容无效。')
    const drafts = this.parse().filter(d => d.targetKey !== targetKey)
    const previous = this.get(targetKey)
    const turns = [...(previous?.turns ?? []), { role: turn.role, text: turn.text.trim() }]
    let truncated = previous?.truncated ?? false
    while (JSON.stringify(turns).length > MAX_TURN_CHARS && turns.length > 1) { turns.shift(); truncated = true }
    const next = [...drafts, { targetKey, turns, updatedAt: Date.now(), ...(truncated ? { truncated: true } : {}) }]
    this.save(next)
  }
  clear(targetKey: string) { this.save(this.parse().filter(d => d.targetKey !== targetKey)) }
  /** Readable chain for requestLog archiving. */
  static render(draft: ContactTaskDraft | undefined, finalMessage: string): string {
    const lines = [...(draft?.turns ?? []).map(t => `${t.role === 'user' ? '用户' : 'ChouYu'}：${t.text}`)]
    lines.push(`用户：${finalMessage}`)
    const text = (draft?.truncated ? '……（更早的补问因草稿长度限制未保留）……\n' : '') + lines.join('\n')
    return appendTaskRequestLog(undefined, text)
  }
}
