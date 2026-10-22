import type { AgentSettings, AgentRun, AgentRunStatus } from '../../../shared/agents';
export type Profile = { character_id: string; settings: string; revision: number; next_at: number; failures: number; focus_topic_id: string | null }
export type RunRow = { id: string; character_id: string; revision: number; status: AgentRunStatus; created_at: number; updated_at: number; question: string; answer: string; summary: string; error: string; input: string; topic_id: string | null; topic_revision: number | null }
export function runContext(row: RunRow): import('../../../shared/contact-content').ContactContextRecord | undefined {
  const input = JSON.parse(row.input), memories = input.suppliedMemories ?? [], materials = input.contextReferences?.materials ?? []
  if (!memories.length && !materials.length) return undefined
  return { characterId: row.character_id, requestId: row.id, memories, materials, truncated: input.memoriesTruncated === true, status: ['failed', 'cancelled', 'interrupted'].includes(row.status) ? 'failed' : 'completed' }
}
export const mapRun = (row: RunRow): AgentRun => ({ calendar: JSON.parse(row.input).calendar, contactContext: runContext(row), id: row.id, characterId: row.character_id, revision: row.revision, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, question: row.question, answer: row.answer, summary: row.summary, error: row.error, topicId: row.topic_id, ...(JSON.parse(row.input).revisionScope === 'presentation' ? { revisionScope: 'presentation' as const } : {}), ...(row.status === 'waiting' && JSON.parse(row.input).questionInputs ? { inputFields: JSON.parse(row.input).questionInputs } : {}) })
export const dayStart = (now: number) => { const date = new Date(now); date.setHours(0, 0, 0, 0); return date.getTime() }

export const failureDelay = (settings: AgentSettings, failures: number) => settings.paceWriting
  ? Math.max(settings.intervalMinutes * 60000, 15 * 60000) : (failures === 1 ? 60000 : 180000)

