import type { AppUpdateState } from '../shared/updates'

interface UpdateBackend {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  on(event: string, listener: (...args: any[]) => void): unknown
  removeListener(event: string, listener: (...args: any[]) => void): unknown
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(silent: boolean, runAfter: boolean): void
}

const CHECK_INTERVAL = 4 * 60 * 60 * 1000
const START_DELAY = 30_000

function errorMessage(error: unknown): string {
  const raw = (error instanceof Error ? error.message : String(error || '')).toLowerCase()
  if (/401|403|bad credentials/.test(raw)) return '暂时无法访问更新源，请稍后重试。'
  if (/404|latest\.yml|not found/.test(raw)) return '暂时无法获取更新信息，请稍后重试。'
  if (/network|enotfound|timeout|econn/.test(raw)) return '无法连接更新服务器，请检查网络后重试。'
  return '更新失败，请稍后重试。'
}

/** Owns authoritative state independently of which renderer panels are mounted. */
export class UpdateService {
  private state: AppUpdateState
  private started = false
  private disposed = false
  private lastAttempt = -Infinity
  private checkPromise?: Promise<void>
  private downloadPromise?: Promise<void>
  private pendingInstall = false
  private startupTimer?: ReturnType<typeof setTimeout>
  private intervalTimer?: ReturnType<typeof setInterval>
  private resumeTimer?: ReturnType<typeof setTimeout>
  private listeners: Array<[string, (...args: any[]) => void]> = []

  constructor(private backend: UpdateBackend, private notify: (state: AppUpdateState) => void,
    private requestQuit: () => void, private supported = true, installFailed = false) {
    this.state = installFailed && supported
      ? { revision: 0, phase: 'error', errorStage: 'install', error: '上次更新未能安装，已重新打开应用，请重试更新。' }
      : { revision: 0, phase: supported ? 'idle' : 'unsupported' }
    backend.autoDownload = false
    backend.autoInstallOnAppQuit = false
  }

  snapshot(): AppUpdateState { return { ...this.state } }

  private set(next: Omit<AppUpdateState, 'revision'>): void {
    if (this.disposed) return
    this.state = { ...next, revision: this.state.revision + 1 }
    this.notify(this.snapshot())
  }

  start(): void {
    if (this.started || this.disposed || !this.supported) return
    this.started = true
    const on = (event: string, listener: (...args: any[]) => void) => {
      this.listeners.push([event, listener]); this.backend.on(event, listener)
    }
    on('update-available', (info: { version: string }) => {
      if (!info?.version || ['downloading', 'ready', 'installing'].includes(this.state.phase)) return
      this.set({ phase: 'available', version: info.version, checkedAt: Date.now() })
      void this.download()
    })
    on('update-not-available', () => {
      if (this.state.phase === 'checking') this.set({ phase: 'upToDate', checkedAt: Date.now() })
    })
    on('download-progress', (progress: { percent: number }) => {
      if (this.state.phase !== 'downloading' || !Number.isFinite(progress.percent)) return
      this.set({ ...this.state, percent: Math.min(100, Math.max(0, progress.percent)) })
    })
    on('update-downloaded', (info: { version: string }) => {
      if (!info?.version || this.state.phase === 'installing') return
      this.set({ phase: 'ready', version: info.version, percent: 100, checkedAt: this.state.checkedAt })
    })
    on('error', (error: unknown) => {
      // Those promises own their failure and stage; an earlier check may reject during a download.
      if (this.checkPromise || this.downloadPromise) return
      const stage = this.state.phase === 'downloading' ? 'download' : this.state.phase === 'installing' ? 'install' : 'check'
      this.fail(error, stage)
    })
    this.startupTimer = setTimeout(() => this.checkIfDue(), START_DELAY)
    // Keep the schedule alive when an attempt is skipped during a long download or sleep.
    this.intervalTimer = setInterval(() => this.checkIfDue(), 60_000)
  }

  private checkIfDue(): void {
    if (Date.now() - this.lastAttempt >= CHECK_INTERVAL) void this.check()
  }

  resume(): void {
    if (this.disposed || !this.supported || this.resumeTimer) return
    this.resumeTimer = setTimeout(() => { this.resumeTimer = undefined; this.checkIfDue() }, START_DELAY)
  }

  private fail(error: unknown, stage: NonNullable<AppUpdateState['errorStage']>): void {
    if (this.disposed || this.state.phase === 'error' || this.state.phase === 'ready') return
    if (stage === 'check' && ['downloading', 'installing'].includes(this.state.phase)) return
    this.set({ phase: 'error', error: errorMessage(error), errorStage: stage,
      version: this.state.version, checkedAt: this.state.checkedAt })
  }

  async check(): Promise<void> {
    if (this.disposed || !this.supported || ['downloading', 'ready', 'installing'].includes(this.state.phase)) return
    if (this.checkPromise) return this.checkPromise
    this.lastAttempt = Date.now()
    this.set({ phase: 'checking' })
    // Defer until the in-flight promise is assigned: backend events can fire synchronously.
    this.checkPromise = Promise.resolve().then(() => this.backend.checkForUpdates())
      .then(() => {
        if (this.state.phase === 'checking') this.fail(new Error('No update result'), 'check')
      }).catch(error => this.fail(error, 'check')).finally(() => { this.checkPromise = undefined })
    return this.checkPromise
  }

  async download(): Promise<void> {
    if (this.disposed || !this.supported || !this.state.version || ['ready', 'installing'].includes(this.state.phase)) return
    if (this.downloadPromise || this.state.phase === 'downloading') return this.downloadPromise
    this.set({ phase: 'downloading', version: this.state.version, percent: 0, checkedAt: this.state.checkedAt })
    this.downloadPromise = Promise.resolve().then(() => this.backend.downloadUpdate())
      .then(() => {}).catch(error => this.fail(error, 'download')).finally(() => { this.downloadPromise = undefined })
    return this.downloadPromise
  }

  requestInstall(): void {
    if (this.disposed || this.state.phase !== 'ready') return
    this.pendingInstall = true
    this.set({ ...this.state, phase: 'installing' })
    this.requestQuit()
  }

  cancelInstall(): void {
    if (!this.pendingInstall) return
    this.pendingInstall = false
    this.set({ ...this.state, phase: 'ready' })
  }

  hasPendingInstall(): boolean { return this.pendingInstall }

  /** Runs only after the existing asynchronous save/quit guard finishes. */
  installAfterCleanup(): void {
    if (this.disposed || !this.pendingInstall) return
    this.pendingInstall = false
    try { this.backend.quitAndInstall(true, true) } catch (error) { this.fail(error, 'install') }
  }

  dispose(): void {
    this.disposed = true
    clearTimeout(this.startupTimer); clearTimeout(this.resumeTimer); clearInterval(this.intervalTimer)
    for (const [event, listener] of this.listeners) this.backend.removeListener(event, listener)
    this.listeners = []
  }
}
