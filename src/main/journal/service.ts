import { mkdtemp, writeFile, unlink, rmdir } from 'fs/promises'
import { tmpdir } from 'os'
import type { JournalSavedItem, JournalSaveInput, JournalSavedUsage } from '../../shared/journal'
import { app, powerMonitor, systemPreferences } from 'electron'
import type { AIResponseMetadata } from '../../shared/ai-usage'
import type { JournalAnalysisRecord } from '../../shared/journal'
import { Worker } from 'worker_threads'
import { join } from 'path'
import { ActivityHelper } from './activity-helper'
import { captureJournalWindow, stopJournalCapture } from './capture'
import { JournalOcr } from './ocr'
import { answerJournalQuestion, generateJournalSummary, selectJournalEvidence } from './summary'
import { JournalQuestionContexts } from './question-context'
import { JournalSemanticSearch } from './semantic-search'
import { DEFAULT_JOURNAL_CONFIG, validateJournalConfig, validateJournalQuery } from '../../shared/journal'
import type { JournalAnswer, JournalDay, JournalCapture, JournalCapturePage, JournalConfig, JournalPage, JournalQuery, JournalStatus, JournalEvidence, JournalSummary, JournalTaskPage, JournalDetail, JournalTaskEdit } from '../../shared/journal'

export class JournalService {
  private questionContexts = new JournalQuestionContexts()
  private semantic = new JournalSemanticSearch(async query => { await this.ready; if (this.closed || this.locked || this.suspended) throw new Error('当前无法执行日志语义检索。'); return this.request<JournalEvidence[]>('semanticInput', query) }, async () => (await import('../database')).getConfig(), fetch, {
    read: async (scope, sources) => { await this.ready; return this.request('readSemanticCache', { scope, sources }) },
    write: async (scope, generation, entries) => { await this.ready; return this.request('writeSemanticCache', { scope, generation, entries }) },
    clear: async () => { await this.ready; return this.request('clearSemanticCache') }
  })
  prepareSemantic(query: JournalQuery) { return this.semantic.prepare(query) }
  searchSemantic(id: string) { return this.semantic.search(id) }
  cancelSemantic() { this.semantic.cancel() }
  clearSemanticCache() { return this.semantic.clearCache() }
  private worker: Worker
  private sequence = 0
  private continuationBusy = false
  private savedRevision = 0
  private requests = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  private helper = new ActivityHelper()
  private bookmarkHelper = new ActivityHelper()
  private quickBusy = false
  private quickBookmarkId = ''
  private config: JournalConfig = { ...DEFAULT_JOURNAL_CONFIG }
  private state: JournalStatus['state'] = 'off'
  private error = ''
  private storageError = ''
  private lastCapturedAt: number | null = null
  private epoch = 0
  private locked = false
  private suspended = false
  private busy = false
  private timer?: ReturnType<typeof setTimeout>
  private changes = Promise.resolve()
  private closed = false
  private captureError = ''
  private lastFrameAt = 0
  private foregroundKey = ''
  private foregroundSince = 0
  private capturedKey = ''
  private failedCaptureKey = ''
  private captureFailures = 0
  private captureRetryAt = 0
  private ocr = new JournalOcr()
  private ocrBusy = false
  private ocrTimer?: ReturnType<typeof setTimeout>
  private summaryController?: AbortController
  private analysisKind: 'summary' | 'question' = 'summary'
  readonly ready: Promise<void>
  private lock = () => { this.locked = true; this.restart() }
  private unlock = () => { this.locked = false; this.restart() }
  private suspend = () => { this.suspended = true; this.restart() }
  private resume = () => { this.suspended = false; this.restart() }

  constructor(options: { recordingDisabled?: boolean } = {}) {
    this.worker = new Worker(join(__dirname, 'journal-worker.js'), { workerData: { directory: join(app.getPath('userData'), 'journal'), recordingDisabled: options.recordingDisabled } })
    this.worker.on('message', ({ id, result, error }) => {
      const pending = this.requests.get(id)
      if (!pending) return
      clearTimeout(pending.timer); this.requests.delete(id)
      if (error) pending.reject(new Error(error)); else pending.resolve(result)
    })
    this.worker.on('error', () => this.failStorage('工作日志数据库无法启动，请检查数据目录后重启应用。'))
    this.worker.on('exit', () => { if (!this.closed) this.failStorage('工作日志存储进程已退出，请重启应用。') })
    this.ready = this.request<JournalConfig>('config').then(async config => { await this.request('analysisRecover'); this.config = config; this.restart() }).catch(error => { this.failStorage(String(error.message || error)) })
    powerMonitor.on('lock-screen', this.lock)
    powerMonitor.on('unlock-screen', this.unlock)
    powerMonitor.on('suspend', this.suspend)
    powerMonitor.on('resume', this.resume)
  }

  private request<T = void>(method: string, payload?: unknown): Promise<T> {
    if (this.storageError) return Promise.reject(new Error(this.storageError))
    return new Promise((resolve, reject) => {
      const id = ++this.sequence
      this.requests.set(id, { resolve, reject, timer: setTimeout(() => this.failStorage('工作日志存储超时，已停止记录。请重启应用。'), 10_000) })
      this.worker.postMessage({ id, method, payload })
    })
  }

  private failStorage(message: string): void {
    this.storageError = message; this.error = message; this.state = 'error'
    this.stopSampling()
    for (const pending of this.requests.values()) { clearTimeout(pending.timer); pending.reject(new Error(message)) }
    this.requests.clear()
  }

  status(): JournalStatus {
    const permissionNotice = process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') !== 'granted'
      ? 'macOS 尚未授予屏幕录制权限：目前只记录应用名称。请在系统设置 → 隐私与安全性 → 屏幕与系统音频录制中允许此应用，然后重启；窗口标题和画面需要此权限。' : ''
    return { quickBookmarkId: this.quickBookmarkId, config: { ...this.config, excludedApps: [...this.config.excludedApps] }, supported: ['win32', 'darwin'].includes(process.platform), permissionNotice, state: this.state, lastCapturedAt: this.lastCapturedAt, error: this.error, captureError: this.captureError, analysis: this.summaryController ? this.analysisKind : null }
  }

  private stopSampling(): void {
    this.semantic.cancel()
    this.epoch++
    clearTimeout(this.timer)
    this.helper.stop()
    this.bookmarkHelper.stop()
    stopJournalCapture()
    clearTimeout(this.ocrTimer)
    this.ocr.stop()
    this.summaryController?.abort()
  }

  private restart(): void {
    this.stopSampling()
    if (this.closed || this.storageError) return
    this.error = ''
    this.captureError = ''; this.lastFrameAt = 0
    this.foregroundKey = ''; this.capturedKey = ''; this.foregroundSince = 0
    this.failedCaptureKey = ''; this.captureFailures = 0; this.captureRetryAt = 0
    this.state = !this.config.enabled ? 'off' : this.config.paused ? 'paused' : this.locked || this.suspended ? 'locked' : 'starting'
    void this.request('cut').catch(error => this.failStorage(error.message))
    if (this.state === 'starting' && !['win32', 'darwin'].includes(process.platform)) { this.state = 'error'; this.error = '活动记录目前仅支持 Windows 和 macOS。'; return }
    if (this.state === 'starting') this.schedule(0)
    if (this.state === 'starting' && this.config.captureEnabled) this.scheduleOcr()
  }

  private schedule(delay = this.config.captureEnabled ? 1000 : 5000): void { this.timer = setTimeout(() => void this.sample(), delay) }

  private async sample(): Promise<void> {
    if (this.closed || !this.config.enabled || this.config.paused || this.locked || this.suspended || this.storageError) return
    if (this.busy || this.quickBusy) { this.schedule(); return }
    this.busy = true
    const startedAt = Date.now()
    const epoch = this.epoch
    try {
      if (powerMonitor.getSystemIdleTime() >= 120) {
        this.foregroundKey = ''; this.capturedKey = ''
        this.state = 'idle'; this.helper.stop(); await this.request('cut')
      } else {
        const sample = await this.helper.read()
        if (epoch !== this.epoch) return
        if (sample.pid === process.pid || this.config.excludedApps.some(name => name === sample.app.toLowerCase() || (process.platform === 'darwin' && name.replace(/\.exe$/, '') === sample.app.toLowerCase()))) {
          this.foregroundKey = ''; this.capturedKey = ''
          this.state = 'excluded'; await this.request('cut')
        } else {
          const activityId = await this.request<number>('sample', { app: sample.app, title: sample.title, at: Date.now() })
          if (epoch !== this.epoch) return
          this.state = 'recording'; this.lastCapturedAt = Date.now()
          const key = JSON.stringify([sample.pid, sample.hwnd, sample.title])
          if (key !== this.foregroundKey) { this.foregroundKey = key; this.foregroundSince = Date.now() }
          const settled = Date.now() - this.foregroundSince >= 1000
          const due = key !== this.capturedKey || Date.now() - this.lastFrameAt >= this.config.captureIntervalSeconds * 1000
          const screenAllowed = process.platform !== 'darwin' || systemPreferences.getMediaAccessStatus('screen') === 'granted'
          if (!screenAllowed) this.captureError = ''
          if (this.config.captureEnabled && screenAllowed && settled && due && (key !== this.failedCaptureKey || Date.now() >= this.captureRetryAt)) {
            this.lastFrameAt = Date.now()
            this.capturedKey = key
            const at = this.lastFrameAt
            try {
              const frame = await captureJournalWindow(sample.hwnd)
              if (epoch !== this.epoch) return
              const current = await this.helper.read()
              if (epoch !== this.epoch) return
              // A changed tab, process or foreground window invalidates the in-flight frame.
              if (current.hwnd !== sample.hwnd || current.pid !== sample.pid || current.title !== sample.title) return
              await this.request('capture', { activityId, width: frame.width, height: frame.height, bytes: frame.bytes, at })
              if (epoch === this.epoch) { this.captureError = ''; this.failedCaptureKey = ''; this.captureFailures = 0; this.captureRetryAt = 0 }
            } catch (error) {
              if (epoch === this.epoch) {
                this.captureFailures = key === this.failedCaptureKey ? this.captureFailures + 1 : 1
                this.failedCaptureKey = key
                const retrySeconds = Math.min(30, 5 * 2 ** Math.min(this.captureFailures - 1, 3))
                this.captureRetryAt = Date.now() + retrySeconds * 1000
                this.captureError = `${error instanceof Error ? error.message : '画面采集失败。'} ${retrySeconds} 秒后重试；活动记录继续。`
              }
            }
          }
        }
      }
      if (epoch === this.epoch) this.error = ''
    } catch (error) {
      if (epoch === this.epoch) { this.state = 'error'; this.error = error instanceof Error ? error.message : '活动采集失败。' }
    } finally {
      this.busy = false
      if (epoch === this.epoch && !this.closed && !this.storageError) {
        const cadence = this.config.captureEnabled && this.state !== 'idle' ? 1000 : 5000
        this.schedule(this.state === 'error' ? 30_000 : Math.max(100, cadence - (Date.now() - startedAt)))
      }
    }
  }

  configure(patch: unknown): Promise<JournalStatus> {
    const operation = this.changes.then(async () => {
      if (this.closed) throw new Error('工作日志正在关闭。')
      await this.ready
      const next = validateJournalConfig(patch, this.config)
      if (next.enabled && !['win32', 'darwin'].includes(process.platform)) throw new Error('活动记录目前仅支持 Windows 和 macOS。')
      this.stopSampling()
      try { this.config = await this.request('configure', next) }
      catch (error) { this.failStorage(error instanceof Error ? error.message : '设置未能保存。'); throw error }
      this.restart()
      return this.status()
    })
    this.changes = operation.then(() => {}, () => {})
    return operation
  }

  async list(query: JournalQuery): Promise<JournalPage> {
    await this.ready
    return this.request('list', validateJournalQuery(query))
  }

  async quickBookmark(): Promise<JournalSavedItem> {
    await this.ready
    if (!this.config.quickBookmarkEnabled) throw new Error('请先在“接着做”开启书签快捷键。')
    if (this.closed || this.locked || this.suspended || this.storageError) throw new Error('当前无法保存书签，请解锁并确认日志存储正常。')
    if (!['win32', 'darwin'].includes(process.platform)) throw new Error('快捷书签目前仅支持 Windows 和 macOS。')
    if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') !== 'granted') throw new Error('请先授予 macOS 屏幕录制权限。')
    if (this.quickBusy) throw new Error('上一张书签正在保存，请稍候。')
    this.quickBusy = true
    const epoch = this.epoch, savedRevision = this.savedRevision
    const check = () => { if (epoch !== this.epoch || savedRevision !== this.savedRevision || this.closed) throw new Error('记录状态已变化，快捷书签已取消。') }
    try {
      const sample = await this.bookmarkHelper.read()
      check()
      if (sample.pid === process.pid || this.config.excludedApps.some(name => name === sample.app.toLowerCase() || (process.platform === 'darwin' && name.replace(/\.exe$/, '') === sample.app.toLowerCase()))) throw new Error('当前应用在排除范围内，未保存书签。')
      const deadline = Date.now() + 10_000
      while (this.busy && Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, 50)); check() }
      if (this.busy) throw new Error('当前采集未结束，请稍后重试书签。')
      const at = Date.now()
      const frame = await captureJournalWindow(sample.hwnd)
      check()
      const current = await this.bookmarkHelper.read()
      check()
      if (current.hwnd !== sample.hwnd || current.pid !== sample.pid || current.title !== sample.title) throw new Error('窗口已切换，未保存画面；请停留在目标窗口重试。')
      const saved = await this.request<JournalSavedItem>('quickBookmark', { sample, at, width: frame.width, height: frame.height, bytes: frame.bytes })
      this.quickBookmarkId = saved.id
      return saved
    } finally {
      this.bookmarkHelper.stop(); this.quickBusy = false
      if (!this.config.enabled || this.config.paused) stopJournalCapture()
    }
  }

  async retrySavedOcr(id: string): Promise<JournalCapture> {
    await this.ready
    if (this.ocrBusy || this.locked || this.suspended || this.closed) throw new Error('当前无法识别，请解锁或等待已有识别完成后重试。')
    this.ocrBusy = true
    const epoch = this.epoch, savedRevision = this.savedRevision
    let directory = ''
    try {
      const image = await this.savedImage(id)
      directory = await mkdtemp(join(tmpdir(), 'chouyu-bookmark-ocr-'))
      const path = join(directory, 'frame.jpg')
      await writeFile(path, Buffer.from(image.slice('data:image/jpeg;base64,'.length), 'base64'), { flag: 'wx' })
      if (epoch !== this.epoch || savedRevision !== this.savedRevision) throw new Error('收藏或记录状态已变化，识别已取消。')
      const text = await this.ocr.read(path)
      if (epoch !== this.epoch || savedRevision !== this.savedRevision) throw new Error('收藏或记录状态已变化，识别已取消。')
      return await this.request('savedOcrDone', { id, text })
    } finally {
      this.ocrBusy = false
      if (!this.config.enabled || this.config.paused) this.ocr.stop()
      if (directory) { await unlink(join(directory, 'frame.jpg')).catch(error => { if (error.code !== 'ENOENT') throw error }); await rmdir(directory) }
    }
  }

  async generateContinuations(range: { from: number; to: number }): Promise<{ created: number; skipped: number; considered: number }> {
    await this.ready
    const query = validateJournalQuery(range)
    if (query.to - query.from > 25 * 3600_000) throw new Error('请按一天生成接续卡。')
    if (this.continuationBusy) throw new Error('接续卡正在生成，请稍候。')
    this.continuationBusy = true
    const epoch = this.epoch, savedRevision = this.savedRevision
    try {
      const existing = await this.summary(query)
      const summary = existing || await this.summarize(query)
      if (epoch !== this.epoch || savedRevision !== this.savedRevision) throw new Error('记录或收藏已变化，接续卡生成已取消。')
      return await this.request('generateContinuations', { ...query, summaryCreatedAt: summary.createdAt })
    } finally { this.continuationBusy = false }
  }
  async saveItem(input: JournalSaveInput): Promise<JournalSavedItem> { await this.ready; return this.request('saveItem', input) }
  async savedItems(): Promise<JournalSavedItem[]> { await this.ready; return this.request('savedItems') }
  async projects(): Promise<import('../../shared/journal-projects').JournalProjectState> { await this.ready; return this.request('projects') }
  async weeklySources(range: import('../../shared/journal-weekly').JournalWeeklyRange): Promise<import('../../shared/journal-weekly').JournalWeeklySource[]> { await this.ready; return this.request('weeklySources', range) }
  async weekly(): Promise<import('../../shared/journal-weekly').JournalWeeklyDraft[]> { await this.ready; return this.request('weekly') }
  async createWeekly(input: import('../../shared/journal-weekly').JournalWeeklyCreate): Promise<import('../../shared/journal-weekly').JournalWeeklyDraft> { await this.ready; return this.request('createWeekly', input) }
  async editWeekly(input: import('../../shared/journal-weekly').JournalWeeklyEdit): Promise<import('../../shared/journal-weekly').JournalWeeklyDraft> { await this.ready; return this.request('editWeekly', input) }
  async deleteWeekly(input: { id: string; revision: number }): Promise<void> { await this.ready; return this.request('deleteWeekly', input) }
  async playbook(): Promise<import('../../shared/journal-playbook').JournalPlaybookEntry[]> { await this.ready; return this.request('playbook') }
  async savePlaybook(input: import('../../shared/journal-playbook').JournalPlaybookInput): Promise<import('../../shared/journal-playbook').JournalPlaybookEntry> { await this.ready; return this.request('savePlaybook', input) }
  async deletePlaybook(input: { id: string; revision: number }): Promise<void> { await this.ready; await this.request('deletePlaybook', input) }
  async saveProject(input: import('../../shared/journal-projects').JournalProjectInput): Promise<import('../../shared/journal-projects').JournalProject> { await this.ready; return this.request('saveProject', input) }
  async deleteProject(id: string): Promise<void> { await this.ready; await this.request('deleteProject', id) }
  async assignProject(input: { savedId: string; projectId: string | null; automatic?: boolean }): Promise<void> { await this.ready; await this.request('assignProject', input) }
  async savedUsage(): Promise<JournalSavedUsage> { await this.ready; return this.request('savedUsage') }
  async savedImage(id: string): Promise<string> { await this.ready; return this.request('savedImage', id) }
  async updateSaved(input: { id: string; pinned?: boolean; completed?: boolean; note?: string }): Promise<void> { await this.ready; return this.request('updateSaved', input) }
  async deleteSaved(id: string): Promise<void> { this.savedRevision++; await this.ready; await this.request('deleteSaved', id); if (this.quickBookmarkId === id) this.quickBookmarkId = '' }
  async captures(query: JournalQuery): Promise<JournalCapturePage> { await this.ready; return this.request('captures', validateJournalQuery(query)) }
  async tasks(query: JournalQuery): Promise<JournalTaskPage> { await this.ready; return this.request('tasks', validateJournalQuery(query)) }
  async detail(input: { from: number; to: number; id: string }): Promise<JournalDetail> { await this.ready; return this.request('detail', { ...validateJournalQuery(input), id: input.id }) }
  async captureInfo(id: string): Promise<JournalCapture> { await this.ready; return this.request('captureInfo', id) }
  editTask(input: JournalTaskEdit): Promise<void> { return this.mutate('editTask', input) }
  deleteActivity(id: number): Promise<void> { return this.mutate('deleteActivity', id) }
  deleteCapture(id: string): Promise<void> { return this.mutate('deleteCapture', id) }
  async image(id: string): Promise<string> { await this.ready; return this.request('image', id) }
  async summary(range: { from: number; to: number }): Promise<JournalSummary | null> { await this.ready; return this.request('summary', validateJournalQuery(range)) }
  async overview(range: { from: number; to: number }): Promise<JournalDay> { await this.ready; return this.request('overview', validateJournalQuery(range)) }
  cancelAnalysis(): void { this.savedRevision++; this.summaryController?.abort() }
  async analysisRecords(range: { from: number; to: number }): Promise<JournalAnalysisRecord[]> { await this.ready; return this.request('analysisRecords', validateJournalQuery(range)) }

  private async trackAnalysis<T>(range: { from: number; to: number }, kind: 'summary' | 'question', config: { provider: string; model: string }, signal: AbortSignal, run: (onMetadata: (value: AIResponseMetadata) => void) => Promise<T>): Promise<T> {
    const id = await this.request<string>('analysisStart', { from: range.from, to: range.to, kind, provider: config.provider, model: config.model, requestedModel: config.model })
    let metadata: AIResponseMetadata = {}
    let state: JournalAnalysisRecord['state'] = 'failed'
    try {
      if (signal.aborted) throw new Error('日志分析已取消。')
      const result = await run(value => { metadata = value })
      state = 'success'
      return result
    } finally {
      await this.request('analysisFinish', { id, model: metadata.model || config.model, usage: metadata.usage, state: signal.aborted ? 'cancelled' : state })
    }
  }

  async ask(input: { from: number; to: number; question: string; conversationId?: string }): Promise<JournalAnswer> {
    await this.ready
    const query = validateJournalQuery(input)
    if (typeof input.question !== 'string' || !input.question.trim() || input.question.length > 1000) throw new Error('请输入 1 至 1000 字的问题。')
    if (this.summaryController) throw new Error('已有日志分析正在进行，请稍后再试。')
    const controller = new AbortController(); this.summaryController = controller
    this.analysisKind = 'question'
    const epoch = this.epoch
    try {
      const evidence = await this.request<{ sources: JournalEvidence[]; truncated: boolean }>('summaryInput', query)
      if (epoch !== this.epoch || controller.signal.aborted) throw new Error('日志已变化，回答已取消。')
      const { getConfig } = await import('../database')
      const config = getConfig()
      const history = this.questionContexts.read(input.conversationId, query, selectJournalEvidence(evidence.sources))
      const run = (onMetadata?: (value: AIResponseMetadata) => void) => answerJournalQuestion({ ...evidence, from: query.from, to: query.to }, input.question.trim(), config, controller.signal, onMetadata, history)
      const answer = evidence.sources.length ? await this.trackAnalysis(query, 'question', config, controller.signal, run) : await run()
      if (epoch !== this.epoch || controller.signal.aborted) throw new Error('日志已变化，回答已取消。')
      return { ...answer, conversationId: this.questionContexts.commit({ from: query.from, to: query.to }, history, input.question.trim(), answer) }
    } catch (error) { if (controller.signal.aborted) throw new Error('日志分析已取消。'); throw error }
    finally { if (this.summaryController === controller) this.summaryController = undefined }
  }

  private scheduleOcr(): void { this.ocrTimer = setTimeout(() => void this.processOcr(), 2000) }
  private async processOcr(): Promise<void> {
    if (this.closed || this.storageError || !this.config.enabled || this.config.paused || !this.config.captureEnabled || this.locked || this.suspended) return
    if (this.ocrBusy) { this.scheduleOcr(); return }
    this.ocrBusy = true
    const epoch = this.epoch
    try {
      const job = await this.request<{ id: string; path: string } | null>('ocrNext')
      if (!job || epoch !== this.epoch) return
      try {
        const text = await this.ocr.read(job.path)
        if (epoch === this.epoch) await this.request('ocrDone', { id: job.id, text })
      } catch (error) {
        if (epoch === this.epoch) await this.request('ocrDone', { id: job.id, error: error instanceof Error ? error.message : 'OCR 失败。' })
      }
    } catch (error) { if (epoch === this.epoch) this.captureError = error instanceof Error ? error.message : '画面索引失败。' }
    finally { this.ocrBusy = false; if (epoch === this.epoch && !this.closed && !this.storageError) this.scheduleOcr() }
  }

  async retryOcr(id: string): Promise<void> {
    await this.ready
    if (this.closed || this.ocrBusy || this.locked || this.suspended) throw new Error('OCR 暂不可用，请稍后重试。')
    this.ocrBusy = true
    const epoch = this.epoch
    try {
      const job = await this.request<{ id: string; path: string }>('ocrJob', id)
      if (epoch !== this.epoch) throw new Error('识别已取消。')
      const text = await this.ocr.read(job.path)
      if (epoch === this.epoch) await this.request('ocrDone', { id, text })
    } catch (error) {
      if (epoch === this.epoch) await this.request('ocrDone', { id, error: error instanceof Error ? error.message : 'OCR 失败。' })
      throw error
    } finally { this.ocrBusy = false; if (!this.config.enabled || this.config.paused) this.ocr.stop() }
  }

  async summarize(range: { from: number; to: number }): Promise<JournalSummary> {
    await this.ready
    const query = validateJournalQuery(range)
    if (this.summaryController) throw new Error('已有日志总结正在生成。')
    const controller = new AbortController(); this.summaryController = controller
    this.analysisKind = 'summary'
    const epoch = this.epoch
    try {
      const input = await this.request<{ sources: JournalEvidence[]; truncated: boolean; generation: number }>('summaryInput', query)
      if (epoch !== this.epoch || controller.signal.aborted) throw new Error('日志已变化，总结已取消。')
      const { getConfig } = await import('../database')
      const config = getConfig()
      const run = (onMetadata?: (value: AIResponseMetadata) => void) => generateJournalSummary({ ...input, from: query.from, to: query.to }, config, controller.signal, onMetadata)
      const summary = input.sources.length ? await this.trackAnalysis(query, 'summary', config, controller.signal, run) : await run()
      if (epoch !== this.epoch || controller.signal.aborted) throw new Error('日志已变化，总结已取消。')
      return await this.request('summarySave', { summary, generation: input.generation })
    } catch (error) { if (controller.signal.aborted) throw new Error('日志分析已取消。'); throw error }
    finally { if (this.summaryController === controller) this.summaryController = undefined }
  }

  deleteRange(range: { from: number; to: number }): Promise<void> {
    return this.mutate('deleteRange', validateJournalQuery(range))
  }

  private mutate(method: string, payload: unknown): Promise<void> {
    const operation = this.changes.then(async () => {
      if (this.closed) throw new Error('工作日志正在关闭。')
      await this.ready
      this.stopSampling()
      try { await this.request(method, payload); if (method.startsWith('delete')) this.questionContexts.clear() } finally { this.restart() }
    })
    this.changes = operation.then(() => {}, () => {})
    return operation
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true; this.stopSampling(); this.questionContexts.clear()
    powerMonitor.removeListener('lock-screen', this.lock)
    powerMonitor.removeListener('unlock-screen', this.unlock)
    powerMonitor.removeListener('suspend', this.suspend)
    powerMonitor.removeListener('resume', this.resume)
    try { await this.changes; await this.request('close') } finally { await this.worker.terminate() }
  }
}
