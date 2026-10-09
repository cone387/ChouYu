import type { AppConfig } from './config'

/** Existing companion responsibilities are views of config, never new schedules. */
export const ASSISTANT_DUTIES = [
  { key: 'proactiveGreeting', title: '每日问好', rule: '每天首次活跃时问好并检查联系人工作，汇报新进展、阻塞与待回复事项；同一天只发送一次。', waiting: '等待当天首次活跃后检查工作' },
  { key: 'proactiveReturn', title: '回来时打招呼', rule: '离开电脑后回来时检查联系人工作，只展开上次汇报后的变化；沿用离开阈值与陪伴消息冷却，错过时不补发。', waiting: '等待离开后回来检查工作' },
  { key: 'proactiveRestReminder', title: '休息提醒', rule: '累计连续活跃使用电脑约一小时后提醒休息；空闲五分钟、锁屏或休眠等会重置估计，与其他陪伴消息共享一小时冷却。', waiting: '等待连续使用达到提醒条件' }
] as const
export type AssistantDutyKey = typeof ASSISTANT_DUTIES[number]['key']
export function enabledAssistantDuties(config: Pick<AppConfig, AssistantDutyKey>): number {
  return ASSISTANT_DUTIES.filter(duty => config[duty.key]).length
}
