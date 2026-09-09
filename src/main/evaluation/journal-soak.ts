import { app, BrowserWindow, powerMonitor } from 'electron'
import { Worker } from 'worker_threads'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { execFile } from 'child_process'
import { performance } from 'perf_hooks'
import { JournalOcr } from '../journal/ocr'
import { captureJournalWindow, stopJournalCapture } from '../journal/capture'
import { cpuFromCounter, summarizeTimings } from './soak-stats'

interface Options { durationMs: number; intervalMs: number; restartMs: number; native: boolean; ocr: boolean; output: string; sourceHash: string; gitHead: string }
const options: Options = JSON.parse(readFileSync(process.env.CHOUYU_SOAK_OPTIONS!, 'utf8'))
const profile = join(options.output, 'profile')
mkdirSync(profile, { recursive: true })
app.setPath('userData', profile)
app.disableHardwareAcceleration()

class Store {
  private worker?: Worker
  private sequence = 0
  private pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  async start() {
    this.worker = new Worker(join(__dirname, 'journal-worker.cjs'), { workerData: { directory: join(profile, 'journal'), recordingDisabled: true } })
    this.worker.on('message', ({ id, result, error }) => {
      const pending = this.pending.get(id)
      if (!pending) return
      clearTimeout(pending.timer); this.pending.delete(id)
      error ? pending.reject(new Error(error)) : pending.resolve(result)
    })
    const fail = (error: Error) => { for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error) }; this.pending.clear() }
    this.worker.on('error', fail)
    this.worker.on('exit', code => fail(new Error(`Storage worker exited (${code})`)))
    await this.request('config')
  }
  request(method: string, payload?: unknown): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Storage timed out: ${method}`)) }, 15000)
      this.pending.set(id, { resolve, reject, timer })
      this.worker!.postMessage({ id, method, payload })
    })
  }
  async close() { if (this.worker) { try { await this.request('close') } finally { await this.worker.terminate(); this.worker = undefined } } }
}

async function helperMetrics(pid: number | undefined): Promise<{ pid: number; seconds: number; workingSetBytes: number; privateBytes: number; at: number } | null> {
  if (process.platform !== 'win32' || !pid || !Number.isSafeInteger(pid)) return null
  const command = `$p=Get-Process -Id ${pid} -ErrorAction Stop; @{pid=$p.Id;seconds=$p.TotalProcessorTime.TotalSeconds;workingSetBytes=$p.WorkingSet64;privateBytes=$p.PrivateMemorySize64}|ConvertTo-Json -Compress`
  return new Promise((resolve, reject) => {
    execFile(join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 5000, maxBuffer: 8192 }, (error, stdout) => {
      if (error) { reject(new Error('OCR helper metrics unavailable')); return }
      try { resolve({ ...JSON.parse(stdout), at: performance.now() }) } catch { reject(new Error('Invalid OCR helper metrics')) }
    })
  })
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const size = (path: string) => { try { return statSync(path).size } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw error } }
const writeReport = (value: unknown) => {
  writeFileSync(join(options.output, 'report.tmp'), JSON.stringify(value, null, 2))
  renameSync(join(options.output, 'report.tmp'), join(options.output, 'report.json'))
}

app.whenReady().then(async () => {
  const store = new Store(), ocr = new JournalOcr()
  let window: BrowserWindow | undefined
  const began = Date.now(), beganMonotonic = performance.now()
  let suspended = false, stopped = false, cycle = 0, success = 0, failures = 0, recoveries = 0, metricFailures = 0
  let nextMetrics = 0, nextRestart = options.restartMs, lastImageId = '', fatal = ''
  const cycleTimes: number[] = [], captureTimes: number[] = [], ocrTimes: number[] = [], memorySamples: number[] = [], cpuSamples: number[] = []
  let previousHelper: Awaited<ReturnType<typeof helperMetrics>> = null
  const append = (value: unknown) => appendFileSync(join(options.output, 'samples.jsonl'), JSON.stringify(value) + '\n')
  const report = (state: 'running' | 'complete' | 'stopped' | 'failed') => ({
    state, pid: process.pid, startedAt: new Date(began).toISOString(), updatedAt: new Date().toISOString(), elapsedMs: performance.now() - beganMonotonic,
    ...options, electron: process.versions.electron, node: process.versions.node, platform: process.platform,
    scope: 'Isolated capture/SQLite/OCR pipeline using only an owned fixture window. Excludes the full chat/memory UI and activity helper; synthetic mode excludes native screen capture. Scripted recovery restarts storage/OCR/capturer, not the OS.',
    cycle, success, failures, recoveries, metricFailures, fatal, cycleTiming: summarizeTimings(cycleTimes), captureTiming: summarizeTimings(captureTimes), ocrTiming: summarizeTimings(ocrTimes),
    peakElectronWorkingSetMB: memorySamples.length ? Math.max(...memorySamples) : null,
    firstElectronWorkingSetMB: memorySamples[0] ?? null, lastElectronWorkingSetMB: memorySamples.at(-1) ?? null,
    meanElectronCpuPercent: cpuSamples.length ? cpuSamples.reduce((a, b) => a + b, 0) / cpuSamples.length : null,
    cpuMeaning: 'Sum of Electron per-process percentCPUUsage. OCR helper CPU and memory are reported separately on Windows. First CPU observations are omitted; observer PowerShell overhead is excluded.',
    metricsPath: join(options.output, 'samples.jsonl')
  })
  powerMonitor.on('suspend', () => { suspended = true; ocr.stop(); stopJournalCapture(); append({ event: 'system-suspend', at: Date.now() }) })
  powerMonitor.on('resume', () => { suspended = false; append({ event: 'system-resume', at: Date.now() }) })
  try {
    await store.start()
    window = new BrowserWindow({ width: 640, height: 360, show: options.native, focusable: false, skipTaskbar: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
    window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }))
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent('<!doctype html><html><body style="background:white;color:#111;font:24px sans-serif;padding:24px"><h1>ChouYu 2026</h1><p>Isolated journal performance fixture</p><p id="cycle">Cycle 0</p><p>Search, OCR and storage recovery</p></body></html>')}`)
    app.getAppMetrics() // Establish the first CPU interval.
    writeReport(report('running'))
    console.log(`SOAK_READY pid=${process.pid} mode=${options.native ? 'native-owned-window' : 'synthetic-hidden-window'} output=${options.output}`)
    while (performance.now() - beganMonotonic < options.durationMs) {
      if (existsSync(join(options.output, 'stop.request'))) { stopped = true; break }
      if (suspended) { await wait(1000); continue }
      const started = performance.now()
      cycle++
      try {
        await window.webContents.executeJavaScript(`document.getElementById('cycle').textContent = 'Cycle ${cycle}'; new Promise(resolve => requestAnimationFrame(resolve))`)
        const captureStart = performance.now()
        const frame = options.native ? await captureJournalWindow(window.getMediaSourceId().split(':')[1]) : await (async () => {
          const image = await window!.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
          return { bytes: image.toJPEG(85), ...image.getSize() }
        })()
        captureTimes.push(performance.now() - captureStart)
        const at = Date.now()
        const activityId = await store.request('sample', { app: 'soak-fixture', title: 'Owned synthetic workload', at })
        const saved = await store.request('capture', { activityId, at, ...frame })
        lastImageId = saved.id
        if (options.ocr) {
          const job = await store.request('ocrJob', saved.id)
          const ocrStart = performance.now()
          const text = await ocr.read(job.path)
          ocrTimes.push(performance.now() - ocrStart)
          if (!text.toLowerCase().includes('chouyu') || !text.includes('2026')) throw new Error('Fixture OCR text missing')
          await store.request('ocrDone', { id: saved.id, text })
        }
        success++
      } catch (error) {
        failures++
        append({ event: 'cycle-failure', cycle, at: Date.now(), error: error instanceof Error ? error.message : String(error) })
      }
      cycleTimes.push(performance.now() - started)
      const elapsed = performance.now() - beganMonotonic
      if (elapsed >= nextMetrics) {
        const processes = app.getAppMetrics().map(item => ({ pid: item.pid, createdAt: item.creationTime, type: item.type, cpuPercent: item.cpu.percentCPUUsage, workingSetKB: item.memory.workingSetSize, privateKB: item.memory.privateBytes ?? null }))
        const workingSetMB = processes.reduce((sum, item) => sum + item.workingSetKB, 0) / 1024
        const cpuPercent = processes.reduce((sum, item) => sum + item.cpuPercent, 0)
        memorySamples.push(workingSetMB)
        if (memorySamples.length > 1) cpuSamples.push(cpuPercent)
        let helper: Awaited<ReturnType<typeof helperMetrics>> = null
        try { helper = await helperMetrics(ocr.processId) } catch (error) { metricFailures++; append({ event: 'metric-failure', at: Date.now(), error: String(error) }) }
        const helperCpuPercent = helper ? cpuFromCounter(previousHelper, helper) : null
        previousHelper = helper
        const captures = await store.request('captures', { from: began - 1000, to: Date.now() + 1 })
        append({ event: 'metrics', at: Date.now(), elapsedMs: elapsed, cycle, success, failures, processes, helper, helperCpuPercent,
          workingSetMB, cpuPercent: memorySamples.length > 1 ? cpuPercent : null, captures: captures.total, mediaBytes: captures.storageBytes, pendingOcr: captures.pendingOcr,
          databaseBytes: size(join(profile, 'journal/journal.db')), walBytes: size(join(profile, 'journal/journal.db-wal')) })
        writeReport(report('running'))
        console.log(`SOAK_PROGRESS elapsedSeconds=${Math.round(elapsed / 1000)} cycles=${cycle} failures=${failures} electronWorkingSetMB=${workingSetMB.toFixed(1)}`)
        nextMetrics = elapsed + 30000
      }
      if (elapsed >= nextRestart && elapsed < options.durationMs) {
        const before = await store.request('captures', { from: began - 1000, to: Date.now() + 1 })
        await store.close(); ocr.stop(); stopJournalCapture(); previousHelper = null
        await wait(1000)
        await store.start()
        const after = await store.request('captures', { from: began - 1000, to: Date.now() + 1 })
        if (before.total !== after.total || before.storageBytes !== after.storageBytes) throw new Error('Restart lost captured records')
        if (lastImageId && !(await store.request('image', lastImageId)).startsWith('data:image/jpeg;base64,')) throw new Error('Restart lost the last image')
        recoveries++
        append({ event: 'pipeline-restart', at: Date.now(), captures: after.total })
        nextRestart = performance.now() - beganMonotonic + options.restartMs
      }
      await wait(Math.max(0, Math.min(options.intervalMs - (performance.now() - started), options.durationMs - (performance.now() - beganMonotonic))))
    }
  } catch (error) { fatal = error instanceof Error ? error.message : String(error) }
  finally {
    ocr.stop(); stopJournalCapture()
    try { await store.close() } catch (error) { fatal ||= String(error) }
    window?.destroy()
    const state = fatal || failures || metricFailures ? 'failed' : stopped ? 'stopped' : 'complete'
    writeReport(report(state))
    console.log(`SOAK_FINISHED state=${state} cycles=${cycle} failures=${failures} recoveries=${recoveries}`)
    app.exit(state === 'failed' ? 1 : 0)
  }
}).catch(error => { writeReport({ state: 'failed', error: String(error), ...options }); console.error(error); app.exit(1) })
