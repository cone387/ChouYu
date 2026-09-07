import fs from 'node:fs'
import { extractMemoryCandidates, extractMemoryKeywords, scoreMemory, detectMemoryRelation } from '../src/shared/memory.ts'

const corpus = JSON.parse(fs.readFileSync(new URL('../tests/fixtures/memory-evaluation.json', import.meta.url), 'utf8'))
const failures = []
let truePositive = 0, falsePositive = 0, falseNegative = 0
let confidenceViolations = 0
for (const item of corpus.extraction) {
  const actual = extractMemoryCandidates(item.text)
  const matched = actual.length === 1 && actual[0].type === item.type && actual[0].content.includes(item.contains || '')
  const confidenceValid = item.maxConfidence === undefined || actual.every(candidate => candidate.confidence <= item.maxConfidence)
  if (!confidenceValid) confidenceViolations++
  if (item.type && matched) truePositive++
  else {
    if (actual.length) falsePositive++
    if (item.type) falseNegative++
  }
  if ((item.type ? !matched : actual.length > 0) || !confidenceValid) failures.push({ suite: 'extraction', id: item.id, expected: { type: item.type, maxConfidence: item.maxConfidence }, actual })
}
const now = Date.UTC(2026, 0, 1)
const records = corpus.memories.map(item => ({ ...item, keywords: extractMemoryKeywords(item.content), importance: 0.8, updatedAt: now, accessCount: 0 }))
let recallHits = 0
for (const item of corpus.retrieval) {
  const top = records.map(record => ({ id: record.id, score: scoreMemory(record, item.query, now) })).sort((a, b) => b.score - a.score).slice(0, 3).map(item => item.id)
  if (top.includes(item.expected)) recallHits++
  else failures.push({ suite: 'retrieval', id: item.id, expected: item.expected, actual: top })
}
let conflictHits = 0
for (const item of corpus.conflicts) {
  const actual = detectMemoryRelation({ type: item.type, content: item.next }, { type: item.previousType || item.type, content: item.previous, keywords: extractMemoryKeywords(item.previous) })?.kind || null
  if (actual === item.expected) conflictHits++
  else failures.push({ suite: 'conflict', id: item.id, expected: item.expected, actual })
}
const report = {
  scope: 'Synthetic labeled corpus; built-in heuristic extraction, lexical ranking and conflict detection. Does not measure an LLM or embedding service.',
  extraction: { count: corpus.extraction.length, precision: truePositive / (truePositive + falsePositive || 1), recall: truePositive / (truePositive + falseNegative || 1), truePositive, falsePositive, falseNegative, confidenceViolations },
  retrieval: { count: corpus.retrieval.length, recallAt3: recallHits / corpus.retrieval.length },
  conflict: { count: corpus.conflicts.length, accuracy: conflictHits / corpus.conflicts.length },
  failures
}
console.log(JSON.stringify(report, null, 2))
if (failures.length) process.exitCode = 1
