export const ASSISTANT_MESSAGE_KINDS = ['greeting', 'rest', 'return', 'task', 'task-backlog', 'snooze', 'warning', 'notification'] as const
export type AssistantMessageKind = typeof ASSISTANT_MESSAGE_KINDS[number]

export function normalizeAssistantMessageKind(value: unknown): AssistantMessageKind | undefined {
  return ASSISTANT_MESSAGE_KINDS.includes(value as AssistantMessageKind) ? value as AssistantMessageKind : undefined
}

/** Only recognize known older reminder templates; leave ordinary replies alone. */
export function legacyAssistantMessageKind(content: string): AssistantMessageKind | undefined {
  if (/^(?:⏰ )?稍后提醒：/.test(content)) return 'snooze'
  if (/^任务提醒：/.test(content)) return 'task'
  if (/^错过了 \d+ 条任务提醒/.test(content)) return 'task-backlog'
  if (/^任务数据文件无法读取/.test(content)) return 'warning'
  if (/^欢迎回来。/.test(content)) return 'return'
  if (/^(这么晚还没睡呀|早上好～|上午好，今天也要加油鸭|中午好～吃饭了没|下午好，继续努力|晚上好～今天辛苦了|夜深了，别太晚睡)/.test(content)) return 'greeting'
  if (/^(你已经连续工作一小时了|该休息一下了，看看远处|久坐不好哦|喝杯水休息一下)/.test(content)) return 'rest'
  return undefined
}
