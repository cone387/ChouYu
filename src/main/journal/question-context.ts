import { randomUUID } from 'crypto'
import type { JournalAnswer, JournalEvidence } from '../../shared/journal'

export interface JournalQuestionTurn { question: string; answer: JournalAnswer }
type Context = { from: number; to: number; turns: JournalQuestionTurn[] }

/** Short-lived, server-owned context; renderer input cannot manufacture past answers. */
export class JournalQuestionContexts {
  private values = new Map<string, Context>()
  clear(): void { this.values.clear() }

  read(id: string | undefined, range: { from: number; to: number }, sources: JournalEvidence[]): JournalQuestionTurn[] {
    if (id === undefined) return []
    if (typeof id !== 'string' || id.length > 64) throw new Error('无效的问答上下文。')
    const value = this.values.get(id)
    if (!value || value.from !== range.from || value.to !== range.to) throw new Error('问答上下文已失效，请开始新问答。')
    for (const turn of value.turns) {
      if (turn.answer.sources.some(old => !sources.some(current => current.id === old.id && current.at === old.at && current.app === old.app && current.title === old.title && current.text === old.text))) {
        this.values.delete(id)
        throw new Error('此前引用的来源已变化或不在本次证据中，请开始新问答。')
      }
    }
    return value.turns
  }

  commit(range: { from: number; to: number }, history: JournalQuestionTurn[], question: string, answer: JournalAnswer): string {
    const id = randomUUID()
    this.values.set(id, { ...range, turns: [...history, { question, answer }].slice(-5) })
    while (this.values.size > 20) this.values.delete(this.values.keys().next().value!)
    return id
  }
}
