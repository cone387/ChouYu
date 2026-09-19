import type { AssistantMessageKind } from '../../../../shared/assistant-message'

const variants: Record<AssistantMessageKind, { label: string; path: string }> = {
  greeting: { label: '日常问候', path: 'M8 1v1m0 12v1M1 8h1m12 0h1M3 3l1 1m8 8 1 1M3 13l1-1m8-8 1-1M11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0' },
  rest: { label: '休息一下', path: 'M2 4h9v5a4.5 4.5 0 0 1-9 0V4Zm9 1h1a2 2 0 0 1 0 4h-1M2 14h11M5 1v1m3-1v1' },
  return: { label: '继续工作', path: 'M6 4 2 8l4 4M2 8h8a4 4 0 0 1 4 4' },
  task: { label: '任务提醒', path: 'M5 3H3v11h10V3h-2M5 2h6v3H5V2Zm0 7 2 2 4-4' },
  'task-backlog': { label: '错过的提醒', path: 'M8 4v4l3 2M3 3A6 6 0 1 1 2 10M1 2v4h4' },
  snooze: { label: '稍后提醒', path: 'M8 5v3l2 1M13 8A5 5 0 1 1 3 8a5 5 0 0 1 10 0M2 1l2 1m8 0 2-1M4 13l-1 2m9-2 1 2' },
  warning: { label: '需要留意', path: 'm8 2 7 12H1L8 2Zm0 4v4m0 2v.1' },
  notification: { label: '助手通知', path: 'M3 11h10l-1-2V6a4 4 0 0 0-8 0v3l-1 2Zm3 2a2 2 0 0 0 4 0' }
}

export default function AssistantMessageLabel({ kind }: { kind: AssistantMessageKind }) {
  const variant = variants[kind]
  return <div className="assistant-message-label">
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={variant.path} /></svg>
    <span>{variant.label}</span>
  </div>
}
