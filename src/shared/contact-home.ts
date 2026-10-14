import type { AgentSummary, AgentTopic } from './agents'
import type { ContactInteraction } from './contact-interactions'
import type { DeliveryRef, PortfolioItem } from './contact-content'
import type { TaskState } from './task-state'
export type ContactHomeData = { pending: ContactInteraction[]; recentDeliveries: PortfolioItem[]; tasks: { topic: AgentTopic; state: TaskState; running: boolean }[]; summary?: AgentSummary; measuredAt: number }
export type ContactCardHighlights = { pending?: string; delivery?: string; task?: string; sources?: { pending?: { characterId: string; interactionId: string; topicId?: string }; delivery?: DeliveryRef } }
export function cardHighlights(data: ContactHomeData): ContactCardHighlights {
  const pending = data.pending.find(item => item.status === 'pending'), delivery = data.recentDeliveries[0], task = data.tasks.find(item => item.running)
  return { ...(pending ? { pending: (pending.question || pending.failure?.message || `${pending.topicTitle}需要你处理`).slice(0, 140) } : {}), ...(delivery ? { delivery: `${delivery.title} · ${delivery.excerpt}`.slice(0, 160) } : {}), ...(task ? { task: `${task.topic.title} · ${task.state.label}` } : {}),
    ...(pending || delivery ? { sources: { ...(pending ? { pending: { characterId: pending.characterId, interactionId: pending.id, topicId: pending.topicId } } : {}), ...(delivery ? { delivery: { ...delivery.ref } } : {}) } } : {}) }
}
