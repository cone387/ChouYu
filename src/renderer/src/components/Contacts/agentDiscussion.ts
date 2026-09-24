/** A visible quotation attached by the user, never an instruction to change work. */
export interface AgentDiscussion {
  title: string
  topicId: string
  runId: string
  text: string
}

export function quoteAgentDiscussion(reference: AgentDiscussion, message: string): string {
  return `【引用联系人工作记录】\n事项：${reference.title}\n事项 ID：${reference.topicId}\n记录 ID：${reference.runId}\n${reference.text.split('\n').map(line => `> ${line}`).join('\n')}\n【我的消息】\n${message}`
}
