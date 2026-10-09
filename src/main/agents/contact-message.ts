import type { DeliveryUpdate } from '../../shared/agent-delivery'
import type { AgentReport, AgentTopic } from '../../shared/agents'

import { contactCommunicationInstructions } from '../../shared/contact-communication'
export const contactMessageInstruction = contactCommunicationInstructions('task')

/** Keep detailed diagnostics in the run record, not in a contact's chat message. */
export function contactFailureReason(error: string): string {
  if (/JSON|格式|校验|成果分节|阶段数量|评分/.test(error)) return '这次生成的内容没能通过交付检查，还没有作为成果交给你。'
  if (/额度|预算|Token/.test(error)) return '当前可用额度不足，这次还没能完成。'
  if (/权限|禁用|工具.*关闭/.test(error)) return '需要的资料或工具权限目前不可用，这次还没能完成。'
  if (/超时|网络|连接|供应商|模型调用失败/.test(error)) return '这次没能顺利取得生成结果，还没有完成交付。'
  return '刚才的工作意外中断了，这次还没能完成。'
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
