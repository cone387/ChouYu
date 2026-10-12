import type { DeliveryUpdate } from '../../shared/agent-delivery'
import type { AgentReport, AgentTopic } from '../../shared/agents'

import { contactCommunicationInstructions } from '../../shared/contact-communication'
import { contactFailure } from '../../shared/contact-failure'
export const contactMessageInstruction = contactCommunicationInstructions('task')

/** Keep detailed diagnostics in the run record, not in a contact's chat message. */
export function contactFailureReason(error: string): string {
  if (/额度|预算|Token/.test(error) && contactFailure(error).kind === 'unknown') return '当前可用额度不足，这次还没能完成。'
  return contactFailure(error).message
}

/** Snapshot the actual deliverable in the same transaction as its saved version. */
export function contactResultMessage(topic: AgentTopic, report: AgentReport, section?: DeliveryUpdate['section'], ended = false): string {
  const title = section?.title.trim() ?? report.title
  const body = section?.body.trim() ?? report.body
  const ending = !ended ? '' : topic.status === 'abandoned'
    ? `我停止了「${topic.title}」这个方向。\n\n`
    : `「${topic.title}」已经完成。\n\n`
  return `${ending}${title}\n\n${body}`
}
