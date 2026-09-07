import { app, BrowserWindow, nativeImage } from 'electron'
import { Worker } from 'worker_threads'
import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { waitForRenderer } from './storage-smoke'
import type { JournalPage } from '../../shared/journal'
import { ActivityHelper } from '../journal/activity-helper'
import { captureJournalWindow } from '../journal/capture'
import { JournalOcr } from '../journal/ocr'
import { createServer } from 'http'
import { getConfig, saveConfig } from '../database'

/** Only synthetic activity in the isolated smoke profile; never enables collection. */
export async function runJournalSmoke(main: BrowserWindow): Promise<void> {
  const initial = await main.webContents.executeJavaScript('window.electronAPI.journal.status()')
  if (initial.state !== 'off' || initial.config.enabled || initial.error) throw new Error('Journal must start disabled with healthy storage')
  const worker = new Worker(join(__dirname, 'journal-worker.js'), { workerData: { directory: join(app.getPath('userData'), 'journal') } })
  let id = 0
  const request = (method: string, payload?: unknown): Promise<any> => new Promise((resolve, reject) => {
    const requestId = ++id
    const fail = (error: Error) => { cleanup(); reject(error) }
    const listener = (reply: any) => { if (reply.id !== requestId) return; cleanup(); reply.error ? reject(new Error(reply.error)) : resolve(reply.result) }
    const timeout = setTimeout(() => fail(new Error('Journal worker smoke timeout')), 8000)
    const cleanup = () => { clearTimeout(timeout); worker.removeListener('message', listener); worker.removeListener('error', fail) }
    worker.on('message', listener); worker.once('error', fail)
    worker.postMessage({ id: requestId, method, payload })
  })
  let journal: BrowserWindow | undefined
  const originalConfig = getConfig()
  let requests = 0
  let sourceId = ''
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        const input = JSON.parse(JSON.parse(body).messages.at(-1).content)
        if (!Array.isArray(input.evidence) || body.includes('data:image/')) throw new Error('Unexpected journal model input')
        requests++
        const content = input.question ? { text: '可以回到工作日志原型，继续检查搜索与来源回看。', sourceIds: [sourceId] } : { items: [{ title: '工作日志原型：搜索与来源回看', kind: 'activity', text: '查看工作日志原型和 Dayflow 设计，记录中保留了搜索文字与窗口画面。', nextStep: '回到原型检查搜索结果是否能打开对应画面。', sourceIds: [sourceId] }] }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(content) } }] })}\n\ndata: [DONE]\n\n`)
      } catch { res.writeHead(400); res.end() }
    })
  })
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Journal smoke provider unavailable')
    saveConfig({ provider: 'openai', model: 'journal-smoke', apiKey: 'synthetic', baseUrl: `http://127.0.0.1:${address.port}/v1` })
    const now = Date.now(); const start = new Date(); start.setHours(0, 0, 0, 0)
    const from = start.getTime(); const end = new Date(start); end.setDate(end.getDate() + 1)
    const to = end.getTime()
    const at = Math.max(from, now - 30_000)
    const activityId = await request('sample', { app: 'editor.exe', title: '工作日志原型 · 完成度 100%', at })
    await request('sample', { app: 'editor.exe', title: '工作日志原型 · 完成度 100%', at: at + 5000 })
    await request('cut')
    await request('sample', { app: 'browser.exe', title: '阅读 Dayflow 设计与实现 · 合成验收数据', at: at + 10_000 })
    await request('sample', { app: 'browser.exe', title: '阅读 Dayflow 设计与实现 · 合成验收数据', at: at + 15_000 })
    const page: JournalPage = await request('list', { from, to })
    if (page.total !== 2 || page.durationMs !== 10_000) throw new Error('Journal intervals did not merge correctly')
    const filtered: JournalPage = await request('list', { from, to, query: '100%' })
    if (filtered.total !== 1) throw new Error('Journal literal wildcard search failed')
    await main.webContents.executeJavaScript('window.electronAPI.journal.open()')
    journal = BrowserWindow.getAllWindows().find(window => window.id !== main.id)
    if (!journal) throw new Error('Journal window did not open')
    await waitForRenderer(journal, "document.querySelector('.journal-timeline') && document.querySelectorAll('.journal-timeline li').length === 2")
    // Validate the native reader without persisting or logging foreground metadata.
    // Windows may deny foreground activation; collection must still report the actual app.
    if (process.platform === 'win32') {
      journal.setAlwaysOnTop(true); journal.show(); journal.focus()
      const helper = new ActivityHelper()
      try {
        const sample = await helper.read()
        if (sample.pid <= 0 || !sample.app.endsWith('.exe') || typeof sample.title !== 'string') throw new Error('Native journal reader returned invalid metadata')
      } finally { helper.stop(); journal.setAlwaysOnTop(false) }
    }
    await main.webContents.executeJavaScript('window.electronAPI.journal.open()')
    if (BrowserWindow.getAllWindows().filter(window => window.id !== main.id).length !== 1) throw new Error('Journal opened duplicate windows')
    await journal.webContents.executeJavaScript("document.querySelector('.journal-controls button').click()")
    await waitForRenderer(journal, "document.querySelector('[aria-label=保留期限]')")
    await journal.webContents.executeJavaScript("document.querySelector('.journal-controls button').click()")
    // Capture only our synthetic test window, never the user's foreground screen.
    const captured = await captureJournalWindow(journal.getMediaSourceId().split(':')[1])
    if (!captured.bytes.length) throw new Error('Native journal window capture was empty')
    const fixture = process.env.CHOUYU_SMOKE_OCR_FIXTURE
    const picture = fixture ? nativeImage.createFromPath(fixture) : nativeImage.createFromBuffer(captured.bytes)
    const imagePayload = { activityId, at, ...picture.getSize(), bytes: picture.toJPEG(90) }
    const saved = await request('capture', imagePayload)
    sourceId = `capture:${saved.id}`
    if ((await request('capture', imagePayload)).id !== saved.id) throw new Error('Journal frame deduplication failed')
    const job = await request('ocrJob', saved.id)
    let recognized = '合成 OCR 证据：工作日志搜索 100%'
    if (fixture) {
      const ocr = new JournalOcr()
      try {
        recognized = await ocr.read(job.path)
        const second = await ocr.read(job.path)
        if (!recognized.includes('ChouYu') || !recognized.includes('2026') || second !== recognized) throw new Error('Persistent native journal OCR failed')
      } finally { ocr.stop() }
    }
    await request('ocrDone', { id: saved.id, text: recognized })
    if ((await request('captures', { from, to, query: fixture ? 'ChouYu' : '100%' })).total !== 1) throw new Error('OCR search failed')
    const dataUrl = await journal.webContents.executeJavaScript(`window.electronAPI.journal.image(${JSON.stringify(saved.id)})`)
    if (!dataUrl.startsWith('data:image/jpeg;base64,')) throw new Error('Journal image retrieval failed')
    const evidence = await request('summaryInput', { from, to })
    const summary = { from, to, createdAt: now, model: 'synthetic-smoke', items: [{ text: '阅读和设计工作日志原型（合成测试）。', sourceIds: [`capture:${saved.id}`] }], sources: evidence.sources, truncated: false }
    await request('summarySave', { generation: evidence.generation, summary })
    await journal.webContents.executeJavaScript("document.querySelectorAll('.journal-view-nav button')[1].click()")
    await waitForRenderer(journal, "document.querySelector('.journal-capture-card img')")
    await journal.webContents.executeJavaScript("document.querySelector('.journal-capture-card').click()")
    await waitForRenderer(journal, "document.querySelector('dialog[open] img') && document.querySelector('dialog pre')")
    await journal.webContents.executeJavaScript("document.querySelector('dialog header button').click()")
    await journal.webContents.executeJavaScript("document.querySelectorAll('.journal-view-nav button')[2].click()")
    await waitForRenderer(journal, "document.querySelector('.journal-summary-items li')")
    await journal.webContents.executeJavaScript("document.querySelector('.journal-summary-intro button').click()")
    await waitForRenderer(journal, "document.querySelector('.journal-summary-items h3') && document.querySelector('.journal-next-step')")
    if (!(await request('summary', { from, to })).coverage.ocrSources) throw new Error('Summary coverage was not persisted')
    const overview = await request('overview', { from, to })
    if (overview.activityCount !== 2 || overview.captureCount !== 1 || overview.ocrReady !== 1) throw new Error('Journal day overview was incorrect')
    await journal.webContents.executeJavaScript("document.querySelector('.journal-source-links button').click()")
    await waitForRenderer(journal, "document.querySelector('dialog[open] img')")
    await journal.webContents.executeJavaScript("document.querySelector('dialog header button').click()")
    await journal.webContents.executeJavaScript("document.querySelectorAll('.journal-view-nav button')[3].click()")
    await waitForRenderer(journal, "document.querySelector('.journal-question-examples button')")
    await journal.webContents.executeJavaScript("document.querySelector('.journal-question-examples button').click()")
    await waitForRenderer(journal, "document.querySelector('.journal-ask textarea').value.length > 0")
    await journal.webContents.executeJavaScript("document.querySelector('.journal-ask form button').click()")
    await waitForRenderer(journal, "document.querySelector('.journal-answer .journal-source-links button')")
    if (requests !== 2) throw new Error('Journal did not use configured provider for summary and question')
    await journal.webContents.executeJavaScript("document.querySelectorAll('.journal-view-nav button')[2].click()")
    await waitForRenderer(journal, "document.querySelector('.journal-summary-items h3')")
    const directory = process.env.CHOUYU_SMOKE_ARTIFACTS
    if (directory) {
      mkdirSync(directory, { recursive: true })
      for (const theme of ['light', 'dark']) {
        for (const width of [1024, 560]) {
          journal.setSize(width, 760)
          await journal.webContents.executeJavaScript(`document.documentElement.dataset.theme='${theme}'; new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
          const overflow = await journal.webContents.executeJavaScript("document.querySelector('.journal-shell').scrollWidth > innerWidth + 1")
          if (overflow) throw new Error('Journal horizontal overflow')
          const screenshot = await journal.webContents.capturePage()
          writeFileSync(join(directory, `journal-summary-${theme}-${width}.png`), screenshot.toPNG())
          await journal.webContents.executeJavaScript("document.querySelectorAll('.journal-view-nav button')[1].click()")
          await waitForRenderer(journal, "document.querySelector('.journal-capture-card img')")
          writeFileSync(join(directory, `journal-captures-${theme}-${width}.png`), (await journal.webContents.capturePage()).toPNG())
          await journal.webContents.executeJavaScript("document.querySelectorAll('.journal-view-nav button')[2].click()")
          await waitForRenderer(journal, "document.querySelector('.journal-summary-items li')")
        }
      }
    }
    await journal.webContents.executeJavaScript("document.querySelectorAll('.journal-view-nav button')[0].click()")
    // Delete through the actual UI, including its explicit confirmation.
    await journal.webContents.executeJavaScript("document.querySelector('.journal-summary button').click()")
    await waitForRenderer(journal, "document.querySelector('.journal-delete')")
    await journal.webContents.executeJavaScript("document.querySelector('.journal-delete div button:last-child').click()")
    await waitForRenderer(journal, "!document.querySelector('.journal-timeline') && document.querySelector('.journal-notice')?.textContent.includes('已删除')")
    if ((await request('list', { from, to })).total !== 0) throw new Error('Journal deletion did not persist')
    if ((await request('captures', { from, to })).total || existsSync(job.path)) throw new Error('Journal deletion retained media')
    if (await request('summary', { from, to })) throw new Error('Journal deletion retained derived summary')
    let imageRejected = false
    try { await request('image', saved.id) } catch { imageRejected = true }
    if (!imageRejected) throw new Error('Deleted image remained accessible')
    const oldGeneration = await request('summaryInput', { from, to })
    await request('deleteRange', { from, to })
    let summaryRejected = false
    try { await request('summarySave', { generation: oldGeneration.generation, summary }) } catch { summaryRejected = true }
    if (!summaryRejected) throw new Error('Late summary resurrected deleted evidence')
    await request('ocrDone', { id: saved.id, text: 'late OCR' })
    if ((await request('captures', { from, to })).total) throw new Error('Late OCR resurrected deleted image')
    await request('sample', { app: 'editor.exe', title: '跨日片段', at: from - 5000 })
    await request('sample', { app: 'editor.exe', title: '跨日片段', at: from + 5000 })
    if ((await request('list', { from, to })).durationMs !== 5000) throw new Error('Cross-day duration was not clipped')
    await request('deleteRange', { from, to })
    if ((await request('list', { from: from - 86400_000, to })).total !== 0) throw new Error('Cross-day deletion retained an overlapping fragment')
    for (let index = 0; index < 101; index++) await request('sample', { app: 'editor.exe', title: `分页样例 ${index}`, at: from + index * 1000 })
    const secondPage = await request('list', { from, to, offset: 100 })
    if (secondPage.total !== 101 || secondPage.items.length !== 1) throw new Error('Journal pagination failed')
    for (let index = 101; index < 450; index++) await request('sample', { app: 'editor.exe', title: `sample ${index}`, at: from + index * 1000 })
    const sampled = await request('summaryInput', { from, to })
    if (!sampled.truncated || sampled.available !== 450 || sampled.sources[0].at !== from || sampled.sources.at(-1).at !== from + 449000) throw new Error('Journal sampling lost a day boundary')
    await request('deleteRange', { from, to })
    // A fresh connection must read disabled state and deleted records.
    const final = await journal.webContents.executeJavaScript('window.electronAPI.journal.status()')
    if (final.config.enabled || final.lastCapturedAt !== null) throw new Error('Smoke accidentally enabled journal collection')
    console.log('CHOUYU_JOURNAL_SMOKE_PASSED opt-in, native helper, SQLite worker, interval merge, Chinese search, pagination, native capture, frame dedup, OCR search, image and summary UI, cascading deletion')
  } finally {
    saveConfig(originalConfig)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    journal?.destroy()
    await request('close').catch(() => {})
    await worker.terminate()
  }
}
