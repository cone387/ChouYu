/** Task requirements are persisted separately; this is only recent conversational context. */
export function contactConversation(messages: { role: string; content: string; timestamp?: number; agentNotice?: unknown }[]): string {
  const recent = messages.filter(m => !m.agentNotice && ['user', 'assistant'].includes(m.role))
    .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0)).slice(-8)
  return recent.map(m => `${m.role}: ${m.content.slice(-1500)}`).join('\n').slice(-4000)
}
