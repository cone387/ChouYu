export type ContactRuntimePhase = 'idle' | 'starting' | 'ready' | 'recovering' | 'unavailable' | 'closing'
export interface ContactRuntimeIssue {
  kind: 'startup' | 'exit' | 'sync' | 'delivery' | 'health' | 'storage'
  at: number
  storage?: { database: 'tasks' | 'checkpoints'; phase: 'open' | 'wal' | 'schema'; code?: string }
}
export interface ContactRuntimeMetrics {
  observedAt: number
  activeRuns: number
  capacity: number
  pendingDeliveries: number
  oldestPendingAt?: number
  eventLoopDelayMs?: number
  backup?: import('./contact-backups').ContactBackupStatus
}
export interface ContactRuntimeSnapshot {
  phase: ContactRuntimePhase
  generation: number
  revision: number
  restartCount: number
  startedAt?: number
  readyAt?: number
  syncedAt?: number
  observedAt?: number
  issue?: ContactRuntimeIssue
  metrics?: ContactRuntimeMetrics
}
export const CONTACT_RUNTIME_LABEL: Record<ContactRuntimePhase, string> = {
  idle: '后台工作尚未启动', starting: '正在连接后台工作', ready: '后台工作已连接',
  recovering: '后台工作正在恢复，任务状态暂不可确认', unavailable: '后台工作暂不可用', closing: '正在停止后台工作'
}
export const CONTACT_RUNTIME_ISSUE: Record<ContactRuntimeIssue['kind'], string> = {
  startup: '后台启动失败', exit: '后台进程已退出', sync: '联系人信息同步失败',
  delivery: '部分消息尚未送达，将沿原记录重试', health: '后台暂时无法响应', storage: '联系人存储暂不可用'
}
