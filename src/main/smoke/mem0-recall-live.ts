import { createHash, randomUUID } from 'crypto'
import type { AppConfig } from '../../shared/config'
import { formatMemoryContext, normalizeMemoryKey, type MemoryRecord } from '../../shared/memory'
import { streamAIChat } from '../ai'
import { Mem0MemorySyncAdapter } from '../memory/sync/mem0-adapter'

interface Corpus {
  memories: { id: string; content: string }[]
  queries: { id: string; query: string; expected: string[] }[]
}

export async function runMem0Recall(config: AppConfig, corpus: Corpus, evaluateEvidence = false) {
  const runId = randomUUID(), userId = `chouyu-recall-${runId}`
  const remote = new Mem0MemorySyncAdapter({ baseUrl: config.memorySyncBaseUrl, apiKey: config.memorySyncApiKey, userId, mode: 'self-hosted' })
  const expectedByLocalId = new Map(corpus.memories.map(memory => [`${runId}:${memory.id}`, memory]))
  const results: { id: string; expected: string[]; actual: string[]; recallAt3: number | null; reciprocalRank: number | null; passed: boolean; error?: string }[] = []
  const evidenceResults: { id: string; rawSelected?: string[]; selected: string[]; answer: string; passed: boolean; error?: string }[] = []
  let scopeVerified = false, cleanupPassed = false, failure = ''
  const classify = (error: unknown) => {
    const text = error instanceof Error ? error.message : ''
    return /认证/.test(text) ? 'authentication' : /超时/.test(text) ? 'timeout' : /无法连接/.test(text) ? 'connection' : 'protocol-or-assertion'
  }
  try {
    if ((await remote.list()).length) throw new Error('Unexpected records in new namespace')
    scopeVerified = true
    const memories: MemoryRecord[] = corpus.memories.map(memory => ({
      id: `${runId}:${memory.id}`, type: 'fact', content: memory.content, normalizedKey: normalizeMemoryKey(memory.content), keywords: [],
      importance: 0.6, confidence: 1, sensitivity: 'normal', status: 'active', createdAt: Date.now(), updatedAt: Date.now(), accessCount: 0, helpfulCount: 0, unhelpfulCount: 0
    }))
    const push = await remote.push(memories)
    if (push.succeeded !== memories.length || push.failed) throw new Error('Incomplete corpus upload')
    const stored = await remote.list()
    if (stored.length !== memories.length || stored.some(memory => expectedByLocalId.get(String(memory.metadata.chouyu_id))?.content !== memory.content)) throw new Error('Corpus readback mismatch')
    for (const sample of corpus.queries) {
      try {
        const records = await remote.search(sample.query, 3)
        const actual = records.map(record => expectedByLocalId.get(String(record.metadata.chouyu_id))?.id || '[unexpected-record]')
        const hitCount = sample.expected.filter(id => actual.includes(id)).length
        const rank = actual.findIndex(id => sample.expected.includes(id))
        results.push({ id: sample.id, expected: sample.expected, actual, recallAt3: sample.expected.length ? hitCount / sample.expected.length : null, reciprocalRank: sample.expected.length ? rank < 0 ? 0 : 1 / (rank + 1) : null, passed: sample.expected.length ? hitCount === sample.expected.length : actual.length === 0 })
        if (evaluateEvidence) {
          try {
            let response = ''
            const context = formatMemoryContext(records.map((record, index) => ({ ...memories.find(memory => memory.id === record.metadata.chouyu_id)!, id: actual[index], score: 1 / (index + 1) })))
            await streamAIChat([{ role: 'user', content: sample.query }], `${context}\n\n请仅输出 JSON：{"answer":"简短回答；没有依据时写 UNKNOWN","evidenceIds":["直接支持回答的 memory ID"]}。只列直接使用的依据；无依据时 evidenceIds 为空数组。`, config, chunk => { response += chunk })
            const parsed = JSON.parse(response.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim())
            if (typeof parsed.answer !== 'string' || !Array.isArray(parsed.evidenceIds) || parsed.evidenceIds.some((id: unknown) => typeof id !== 'string')) throw new Error('Invalid evidence response')
            const rawSelected = parsed.evidenceIds as string[]
            const selected = [...new Set(rawSelected.map(id => id.replace(/^memory:/, '')))]
            evidenceResults.push({ id: sample.id, rawSelected, selected, answer: parsed.answer.slice(0, 1000), passed: selected.length === sample.expected.length && sample.expected.every(id => selected.includes(id)) && (sample.expected.length > 0 || parsed.answer === 'UNKNOWN') })
          } catch (error) { evidenceResults.push({ id: sample.id, selected: [], answer: '', passed: false, error: classify(error) }) }
        }
      } catch (error) { results.push({ id: sample.id, expected: sample.expected, actual: [], recallAt3: null, reciprocalRank: null, passed: false, error: classify(error) }) }
    }
  } catch (error) { failure = classify(error) }
  finally {
    if (scopeVerified) {
      try {
        for (const record of await remote.list()) {
          if (expectedByLocalId.get(String(record.metadata.chouyu_id))?.content !== record.content) throw new Error('Unexpected cleanup record')
          await remote.deleteRemote(record.id)
        }
        cleanupPassed = (await remote.list()).length === 0
      } catch (error) { failure += ` cleanup:${classify(error)}` }
    }
  }
  const positives = results.filter(result => result.expected.length && !result.error)
  const negatives = results.filter(result => !result.expected.length && !result.error)
  return {
    timestamp: new Date().toISOString(), host: new URL(config.memorySyncBaseUrl).hostname, userId, runId,
    corpusSha256: createHash('sha256').update(JSON.stringify(corpus)).digest('hex'), scope: 'Synthetic labeled corpus; configured Mem0 search endpoint, k=3. No user conversation data.',
    memoryCount: corpus.memories.length, queryCount: corpus.queries.length, completedQueries: results.length, errors: results.filter(result => result.error).length,
    meanRecallAt3: positives.length ? positives.reduce((sum, result) => sum + result.recallAt3!, 0) / positives.length : null,
    meanReciprocalRank: positives.length ? positives.reduce((sum, result) => sum + result.reciprocalRank!, 0) / positives.length : null,
    meanPrecisionAt3: positives.length ? positives.reduce((sum, result) => sum + result.actual.filter(id => result.expected.includes(id)).length / 3, 0) / positives.length : null,
    negativeQueries: negatives.length, negativeAbstentions: negatives.filter(result => result.passed).length,
    evidenceSelection: evaluateEvidence ? { model: config.model, passed: evidenceResults.filter(result => result.passed).length, count: evidenceResults.length, results: evidenceResults } : null,
    results, failure, scopeVerified, cleanupPassed,
    passed: !failure && cleanupPassed && results.length === corpus.queries.length && results.every(result => result.passed)
  }
}
