import { describe, expect, it } from 'vitest'
import { JournalQuestionContexts } from './question-context'
import type { JournalAnswer } from '../../shared/journal'

const range = { from: 0, to: 10 }
const source = { id: 'activity:1', at: 1, app: 'editor', title: 'file', text: 'evidence' }
const answer: JournalAnswer = { text: '查看文档', sourceIds: [source.id], sources: [source], model: 'test', truncated: false }
describe('journal conversation context', () => {
  it('rejects missing, deleted, rewritten and reused sources', () => {
    for (const sources of [[], [{ ...source, text: 'rewritten' }], [{ ...source, at: 2 }]]) {
      const contexts = new JournalQuestionContexts(), id = contexts.commit(range, [], '文档在哪', answer)
      expect(() => contexts.read(id, range, sources)).toThrow('来源已变化')
    }
  })
  it('isolates ranges and cannot accept a manufactured conversation', () => {
    const contexts = new JournalQuestionContexts(), id = contexts.commit(range, [], '文档在哪', answer)
    expect(contexts.read(id, range, [source])[0].question).toBe('文档在哪')
    expect(() => contexts.read(id, { from: 10, to: 20 }, [source])).toThrow('失效')
    expect(() => contexts.read('invented', range, [source])).toThrow('失效')
  })
  it('bounds recent history and the number of retained context tokens', () => {
    const contexts = new JournalQuestionContexts()
    let id = contexts.commit(range, [], '0', answer)
    const first = id
    for (let index = 1; index <= 21; index++) id = contexts.commit(range, contexts.read(id, range, [source]), String(index), answer)
    expect(contexts.read(id, range, [source]).map(turn => turn.question)).toEqual(['17', '18', '19', '20', '21'])
    expect(() => contexts.read(first, range, [source])).toThrow('失效')
  })
})
