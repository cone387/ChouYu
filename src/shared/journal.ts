import type { AIUsage } from './ai-usage'

export interface JournalAnalysisRecord {
  id: string; from: number; to: number; createdAt: number; finishedAt?: number
  kind: 'summary' | 'question'; provider: string; model: string; requestedModel: string
  state: 'running' | 'success' | 'failed' | 'cancelled'; usage?: AIUsage
}
export interface JournalConfig {
  enabled: boolean
  paused: boolean
  retentionDays: number
  excludedApps: string[]
  captureEnabled: boolean
  captureIntervalSeconds: number
  maxStorageMB: number
}

export interface JournalSample {
  app: string
  title: string
  pid: number
  idleSeconds: number
  hwnd: string
}

export interface JournalActivity {
  id: number
  app: string
  title: string
  startedAt: number
  endedAt: number
}

export interface JournalStatus {
  config: JournalConfig
  supported: boolean
  permissionNotice?: string
  state: 'off' | 'paused' | 'locked' | 'starting' | 'recording' | 'idle' | 'excluded' | 'error'
  lastCapturedAt: number | null
  error: string
  captureError: string
  analysis?: 'summary' | 'question' | null
}

export interface JournalQuery { from: number; to: number; query?: string; offset?: number }
export interface JournalPage { items: JournalActivity[]; total: number; durationMs: number }
export interface JournalTask {
  id: string; title: string; text: string; kind: NonNullable<JournalSummaryItem['kind']>
  nextStep?: string; category: string; note: string; edited: boolean; organized: boolean
  sourceIds: string[]; activityIds: number[]; captureIds: string[]; apps: string[]
  startedAt: number; endedAt: number; durationMs: number
}
export interface JournalTaskPage { items: JournalTask[]; total: number; organized: number }
export interface JournalDetail { task: JournalTask; activities: JournalActivity[]; captures: JournalCapture[] }
export interface JournalTaskEdit { from: number; to: number; id: string; title: string; category: string; note: string }
export interface JournalAPI {
  open(): Promise<void>
  status(): Promise<JournalStatus>
  configure(patch: Partial<JournalConfig>): Promise<JournalStatus>
  list(query: JournalQuery): Promise<JournalPage>
  tasks(query: JournalQuery): Promise<JournalTaskPage>
  detail(input: { from: number; to: number; id: string }): Promise<JournalDetail>
  editTask(input: JournalTaskEdit): Promise<void>
  deleteActivity(id: number): Promise<void>
  deleteCapture(id: string): Promise<void>
  captureInfo(id: string): Promise<JournalCapture>
  deleteRange(range: { from: number; to: number }): Promise<void>
  captures(query: JournalQuery): Promise<JournalCapturePage>
  image(id: string): Promise<string>
  retryOcr(id: string): Promise<void>
  summarize(range: { from: number; to: number }): Promise<JournalSummary>
  summary(range: { from: number; to: number }): Promise<JournalSummary | null>
  overview(range: { from: number; to: number }): Promise<JournalDay>
  ask(input: { from: number; to: number; question: string }): Promise<JournalAnswer>
  cancelAnalysis(): Promise<void>
  analysisRecords(range: { from: number; to: number }): Promise<JournalAnalysisRecord[]>
}

export interface JournalCapture {
  id: string; activityId: number; app: string; title: string; capturedAt: number
  width: number; height: number; bytes: number; ocrText: string
  ocrStatus: 'pending' | 'ready' | 'failed'; ocrError: string
}
export interface JournalCapturePage { items: JournalCapture[]; total: number; storageBytes: number; pendingOcr: number }
export interface JournalEvidence { id: string; at: number; endedAt?: number; app: string; title: string; text: string }
export interface JournalDay {
  activityCount: number; durationMs: number; captureCount: number; ocrReady: number; ocrFailed: number
  firstAt: number | null; lastAt: number | null
  apps: Array<{ app: string; durationMs: number; count: number }>
}
export interface JournalSummaryItem {
  id?: string
  category?: string; note?: string; edited?: boolean
  text: string; sourceIds: string[]; title?: string
  kind?: 'activity' | 'progress' | 'blocker' | 'decision'
  nextStep?: string
}
export interface JournalAnswer { text: string; sourceIds: string[]; sources: JournalEvidence[]; model: string; truncated: boolean; usage?: AIUsage }
export interface JournalSummary {
  from: number; to: number; createdAt: number; model: string
  usage?: AIUsage
  items: JournalSummaryItem[]
  sources: JournalEvidence[]; truncated: boolean
  version?: number
  coverage?: { available: number; analyzed: number; ocrSources: number }
}

export const DEFAULT_JOURNAL_CONFIG: JournalConfig = {
  enabled: true, paused: false, retentionDays: 30,
  captureEnabled: true, captureIntervalSeconds: 5, maxStorageMB: 2048,
  excludedApps: ['1password.exe', 'bitwarden.exe', 'keepass.exe', 'keepassxc.exe', 'authy.exe']
}

export function validateJournalConfig(value: unknown, current: JournalConfig): JournalConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('无效的日志设置。')
  const patch = value as Record<string, unknown>
  if (Object.keys(patch).some(key => !['enabled', 'paused', 'retentionDays', 'excludedApps', 'captureEnabled', 'captureIntervalSeconds', 'maxStorageMB'].includes(key))) throw new Error('未知日志设置。')
  for (const key of ['enabled', 'paused', 'captureEnabled']) {
    if (patch[key] !== undefined && typeof patch[key] !== 'boolean') throw new Error('记录状态必须为布尔值。')
  }
  if (patch.retentionDays !== undefined && ![7, 30, 90].includes(patch.retentionDays as number)) throw new Error('保留期限须为 7、30 或 90 天。')
  if (patch.captureIntervalSeconds !== undefined && ![5, 10, 20, 30, 60].includes(patch.captureIntervalSeconds as number)) throw new Error('画面间隔须为 5、10、20、30 或 60 秒。')
  if (patch.maxStorageMB !== undefined && ![256, 512, 1024, 2048].includes(patch.maxStorageMB as number)) throw new Error('无效的画面存储上限。')
  if (patch.excludedApps !== undefined && (!Array.isArray(patch.excludedApps) || patch.excludedApps.length > 100 || patch.excludedApps.some(item => typeof item !== 'string' || !/^[^\\/:*?"<>|\r\n]{1,104}$/i.test(item) || !item.trim()))) throw new Error('排除应用请填写进程名或 macOS 应用名，例如 chrome.exe 或 Safari，每行一个。')
  return { enabled: patch.enabled === undefined ? current.enabled : patch.enabled as boolean,
    captureEnabled: patch.captureEnabled === undefined ? current.captureEnabled : patch.captureEnabled as boolean,
    captureIntervalSeconds: patch.captureIntervalSeconds === undefined ? current.captureIntervalSeconds : patch.captureIntervalSeconds as number,
    maxStorageMB: patch.maxStorageMB === undefined ? current.maxStorageMB : patch.maxStorageMB as number,
    paused: patch.paused === undefined ? current.paused : patch.paused as boolean,
    retentionDays: patch.retentionDays === undefined ? current.retentionDays : patch.retentionDays as number,
    excludedApps: patch.excludedApps === undefined ? [...current.excludedApps] : [...new Set((patch.excludedApps as string[]).map(item => item.toLowerCase()))] }
}

/** Upgrade only the previous title-only preset, once per database schema upgrade. */
export function migrateJournalConfig(value: unknown, version: number): JournalConfig {
  const previous = validateJournalConfig(value || {}, DEFAULT_JOURNAL_CONFIG)
  if (version > 0 && version < 3 && !previous.captureEnabled && previous.captureIntervalSeconds === 20) {
    return { ...previous, enabled: true, captureEnabled: true, captureIntervalSeconds: 5, maxStorageMB: previous.maxStorageMB === 512 ? 2048 : previous.maxStorageMB }
  }
  return previous
}

export function validateJournalQuery(value: unknown): Required<JournalQuery> {
  if (!value || typeof value !== 'object') throw new Error('无效查询。')
  const input = value as JournalQuery
  if (!Number.isSafeInteger(input.from) || !Number.isSafeInteger(input.to) || input.from < 0 || input.to <= input.from || input.to - input.from > 32 * 86400_000) throw new Error('每次查询最多 32 天。')
  if (input.query !== undefined && (typeof input.query !== 'string' || input.query.length > 200)) throw new Error('搜索词过长。')
  if (input.offset !== undefined && (!Number.isSafeInteger(input.offset) || input.offset < 0)) throw new Error('无效分页。')
  return { from: input.from, to: input.to, query: input.query?.trim() || '', offset: input.offset || 0 }
}
