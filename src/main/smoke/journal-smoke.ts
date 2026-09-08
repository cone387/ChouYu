import { app, BrowserWindow, nativeImage } from 'electron'
import { Worker } from 'worker_threads'
import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { waitForRenderer } from './storage-smoke'
import type { JournalPage } from '../../shared/journal'
import { ActivityHelper } from '../journal/activity-helper'
import { captureJournalWindow, stopJournalCapture } from '../journal/capture'
import { JournalOcr } from '../journal/ocr'
import { createServer } from 'http'
import { getConfig, saveConfig } from '../database'

/** Only synthetic activity in the isolated smoke profile; never enables collection. */
export async function runJournalSmoke(main: BrowserWindow): Promise<void> {
  const syntheticCapture = process.env.CHOUYU_SMOKE_SYNTHETIC_CAPTURE === '1'
  const initial = await main.webContents.executeJavaScript('window.electronAPI.journal.status()')
  if (initial.state !== 'off' || initial.config.enabled || initial.error) throw new Error('Journal smoke fixture must explicitly disable collection with healthy storage')
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
        res.end(`data: ${JSON.stringify({ model: 'journal-smoke-resolved', choices: [{ delta: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 } })}\n\ndata: [DONE]\n\n`)
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
    journal = main
    await waitForRenderer(journal, "document.querySelector('[data-workspace-page=journal]')")
    await waitForRenderer(journal, "document.querySelector('.journal-mode-switch button:last-child')")
    await waitForRenderer(journal, "document.querySelectorAll('.journal-task-card').length === 2")
    await journal.webContents.executeJavaScript("document.querySelector('.journal-mode-switch button:last-child').click()")
    await waitForRenderer(journal, "document.querySelector('.journal-timeline') && document.querySelectorAll('.journal-timeline li').length === 2")
    // Validate the native reader without persisting or logging foreground metadata.
    // Windows may deny foreground activation; collection must still report the actual app.
    if (process.platform === 'win32' && !syntheticCapture) {
      journal.setAlwaysOnTop(true); journal.show(); journal.focus()
      const helper = new ActivityHelper()
      try {
        const sample = await helper.read()
        if (sample.pid <= 0 || !sample.app.endsWith('.exe') || typeof sample.title !== 'string') throw new Error('Native journal reader returned invalid metadata')
      } finally { helper.stop(); journal.setAlwaysOnTop(false) }
    }
    await main.webContents.executeJavaScript('window.electronAPI.journal.open()')
    if (BrowserWindow.getAllWindows().some(window => window.id !== main.id && window.webContents.getURL().includes('view=journal'))) throw new Error('Journal opened a separate window')
    await journal.webContents.executeJavaScript("document.querySelector('[aria-label=记录设置]').click()")
    await waitForRenderer(journal, "document.querySelector('.journal-settings-dialog:modal') && document.querySelector('[aria-label=保留期限]')")
    await journal.webContents.executeJavaScript("document.querySelector('[aria-label=关闭记录设置]').click()")
    await waitForRenderer(journal, "!document.querySelector('dialog')")
    journal.show(); journal.focus()
    await journal.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    // Capture only our synthetic test window, never the user's foreground screen.
    const captured = syntheticCapture
      ? { bytes: (await journal.webContents.capturePage()).toJPEG(90) }
      : await captureJournalWindow(journal.getMediaSourceId().split(':')[1])
    if (!captured.bytes.length) throw new Error('Native journal window capture was empty')
    if (!syntheticCapture) {
      const capturer = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/journal-capture.html'))
      if (!capturer || capturer.isVisible() || !(await capturer.webContents.executeJavaScript("document.querySelector('video').srcObject === null"))) throw new Error('Journal capturer was visible or retained a live stream')
      const repeated = await captureJournalWindow(journal.getMediaSourceId().split(':')[1])
      if (!repeated.bytes.length || capturer.isDestroyed()) throw new Error('Repeated target capture did not reuse the isolated renderer')
      stopJournalCapture()
      if (!capturer.isDestroyed()) throw new Error('Stopping capture did not release the renderer')
      if (!(await captureJournalWindow(journal.getMediaSourceId().split(':')[1])).bytes.length) throw new Error('Target capture did not resume after stop')
    } else {
      console.log('CHOUYU_JOURNAL_NATIVE_CAPTURE_SKIPPED explicit CI synthetic capture mode; native helper and WGC require separate interactive Windows acceptance')
    }
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
    await waitForRenderer(journal, "document.querySelector('.journal-capture-card')")
    await journal.webContents.executeJavaScript("document.querySelector('.journal-capture-card').scrollIntoView({block:'center'})")
    try { await waitForRenderer(journal, "document.querySelector('.journal-capture-card img')") } catch (error) {
      const directory = process.env.CHOUYU_JOURNAL_ARTIFACTS
      if (directory) { mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, 'capture-failure.png'), (await journal.webContents.capturePage()).toPNG()) }
      console.log('Journal capture diagnostic', await journal.webContents.executeJavaScript("JSON.stringify({dialog:!!document.querySelector('dialog:modal'), card:document.querySelector('.journal-capture-card')?.getBoundingClientRect(), text:document.querySelector('.journal-capture-card')?.textContent})"))
      throw error
    }
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
    const usageRecords = await request('analysisRecords', { from, to })
    if (usageRecords.length !== 2 || usageRecords.some((record: any) => record.model !== 'journal-smoke-resolved' || record.requestedModel !== 'journal-smoke' || record.usage?.totalTokens !== 160 || record.state !== 'success')) throw new Error('Journal model and token history did not persist')
    if ((await request('summary', { from, to })).usage?.inputTokens !== 120) throw new Error('Summary lost token usage')
    await journal.webContents.executeJavaScript("document.querySelectorAll('.journal-view-nav button')[4].click()")
    await waitForRenderer(journal, "document.querySelectorAll('.journal-usage-list li').length === 2 && document.querySelector('.journal-usage-history').textContent.includes('320')")
    // Question and draft survive both tab navigation and a round trip to another date.
    await journal.webContents.executeJavaScript("document.querySelectorAll('.journal-view-nav button')[0].click()")
    await journal.webContents.executeJavaScript("document.querySelectorAll('.journal-view-nav button')[3].click()")
    await waitForRenderer(journal, "document.querySelector('.journal-answer') && document.querySelector('.journal-ask textarea').value.length > 0")
    await journal.webContents.executeJavaScript("document.querySelector('[aria-label=前一天]').click()")
    await waitForRenderer(journal, "!document.querySelector('.journal-answer') && !document.querySelector('.journal-ask textarea').value")
    await journal.webContents.executeJavaScript("document.querySelector('[aria-label=后一天]').click()")
    await waitForRenderer(journal, "document.querySelector('.journal-answer') && document.querySelector('.journal-ask textarea').value.length > 0")

    const secondFrame = await request('capture', { ...imagePayload, at: at + 1000, bytes: picture.resize({ width: Math.max(1, picture.getSize().width - 1) }).toJPEG(80) })
    await request('ocrDone', { id: secondFrame.id, text: '第二张合成画面' })
    await journal.webContents.executeJavaScript("document.querySelectorAll('.journal-view-nav button')[0].click()")
    await waitForRenderer(journal, "document.querySelector('.journal-mode-switch button:first-child')")
    await journal.webContents.executeJavaScript("document.querySelector('.journal-mode-switch button:first-child').click()")
    await waitForRenderer(journal, "document.querySelectorAll('.journal-task-card').length === 2")
    const organized = (await request('tasks', { from, to })).items.find((task: any) => task.organized)
    if (!organized || organized.captureIds.length !== 2) throw new Error('Task did not connect activity frames')
    await journal.webContents.executeJavaScript("[...document.querySelectorAll('.journal-task-card')].find(button => button.textContent.includes('搜索与来源回看')).click()")
    await waitForRenderer(journal, "document.querySelector('.journal-detail-panel[open] img') && document.querySelector('.journal-ocr-text pre')")
    await journal.webContents.executeJavaScript("document.querySelector('.journal-detail-meta button').click()")
    await waitForRenderer(journal, "document.querySelector('.journal-edit-form')")
    await journal.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('[aria-label=事项标题]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'手动修正：登录排查'); input.dispatchEvent(new Event('input',{bubbles:true}));
      const category = document.querySelector('[aria-label=事项分类]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(category,'开发'); category.dispatchEvent(new Event('input',{bubbles:true}));
      const note = document.querySelector('[aria-label=事项备注]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(note,'保留原始依据，明天继续'); note.dispatchEvent(new Event('input',{bubbles:true}));
    })()`)
    await journal.webContents.executeJavaScript("document.querySelector('.journal-edit-form > button').click()")
    await waitForRenderer(journal, "document.querySelector('.journal-detail-panel .journal-notice')?.textContent.includes('已保存')")
    if (!(await request('tasks', { from, to })).items.some((task: any) => task.title === '手动修正：登录排查' && task.category === '开发' && task.note.includes('明天'))) throw new Error('Task edits did not persist across database connections')
    if ((await request('list', { from, to, query: '完成度 100%' })).total !== 1) throw new Error('Task edit overwrote raw evidence')
    await journal.webContents.executeJavaScript("document.querySelector('[aria-label=下一张画面]').click()")
    await waitForRenderer(journal, "document.querySelector('.journal-ocr-text pre')?.textContent.includes('第二张合成画面')")
    await journal.webContents.executeJavaScript("document.querySelector('.journal-frame-caption button').click()")
    await waitForRenderer(journal, "document.querySelector('.journal-detail-panel .journal-delete')")
    await journal.webContents.executeJavaScript("(() => { const input = document.querySelector('[aria-label=画面时间位置]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'0'); input.dispatchEvent(new Event('input',{bubbles:true})); })()")
    await waitForRenderer(journal, `!document.querySelector('.journal-detail-panel .journal-delete') && document.querySelector('.journal-ocr-text pre')?.textContent.includes(${JSON.stringify(recognized)})`)
    await journal.webContents.executeJavaScript("document.querySelector('[aria-label=下一张画面]').click()")
    await waitForRenderer(journal, "document.querySelector('.journal-ocr-text pre')?.textContent.includes('第二张合成画面')")
    await journal.webContents.executeJavaScript("document.querySelector('.journal-frame-heading button:last-child').click()")
    await waitForRenderer(journal, "document.querySelector('.journal-frame-viewport.is-zoomed')")
    await journal.webContents.executeJavaScript("document.querySelector('.journal-frame-caption button').click()")
    await waitForRenderer(journal, "document.querySelector('.journal-detail-panel .journal-delete')")
    await journal.webContents.executeJavaScript("document.querySelector('.journal-detail-panel .journal-delete div button:last-child').click()")
    await waitForRenderer(journal, "!document.querySelector('.journal-detail-panel')")
    if ((await request('captures', { from, to })).total !== 1 || (await request('list', { from, to })).total !== 2) throw new Error('Single-frame deletion removed unrelated evidence')
    // Regeneration must keep the user's title and notes when the cited evidence still matches.
    await journal.webContents.executeJavaScript(`window.electronAPI.journal.summarize(${JSON.stringify({ from, to })})`)
    if (!(await request('tasks', { from, to })).items.some((task: any) => task.title === '手动修正：登录排查')) throw new Error('Regeneration discarded task correction')
    if ((await request('summary', { from, to })).items[0].title !== '手动修正：登录排查') throw new Error('Summary did not reflect the corrected title')
    await journal.webContents.executeJavaScript("document.querySelectorAll('.journal-view-nav button')[2].click()")
    await waitForRenderer(journal, "document.querySelector('.journal-summary-items h3')")
    const directory = process.env.CHOUYU_JOURNAL_ARTIFACTS || process.env.CHOUYU_SMOKE_ARTIFACTS
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
          await journal.webContents.executeJavaScript("document.querySelector('[aria-label=记录设置]').click()")
          await waitForRenderer(journal, "document.querySelector('.journal-settings-dialog:modal')")
          await journal.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
          if (await journal.webContents.executeJavaScript("document.querySelector('.journal-settings-dialog').scrollWidth > document.querySelector('.journal-settings-dialog').clientWidth + 1")) throw new Error('Journal settings horizontal overflow')
          writeFileSync(join(directory, `journal-settings-${theme}-${width}.png`), (await journal.webContents.capturePage()).toPNG())
          journal.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
          journal.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
          await waitForRenderer(journal, "!document.querySelector('.journal-settings-dialog')")
          await journal.webContents.executeJavaScript("document.querySelectorAll('.journal-view-nav button')[4].click()")
          await waitForRenderer(journal, "document.querySelectorAll('.journal-usage-list li').length === 3")
          writeFileSync(join(directory, `journal-usage-${theme}-${width}.png`), (await journal.webContents.capturePage()).toPNG())
          await journal.webContents.executeJavaScript("document.querySelectorAll('.journal-view-nav button')[1].click()")
          await waitForRenderer(journal, "document.querySelector('.journal-capture-card')")
          await journal.webContents.executeJavaScript("document.querySelector('.journal-capture-card').scrollIntoView({block:'center'})")
          await waitForRenderer(journal, "document.querySelector('.journal-capture-card img')")
          writeFileSync(join(directory, `journal-captures-${theme}-${width}.png`), (await journal.webContents.capturePage()).toPNG())
          await journal.webContents.executeJavaScript("document.querySelectorAll('.journal-view-nav button')[0].click()")
          await waitForRenderer(journal, "document.querySelector('.journal-task-card')")
          writeFileSync(join(directory, `journal-tasks-${theme}-${width}.png`), (await journal.webContents.capturePage()).toPNG())
          await journal.webContents.executeJavaScript("[...document.querySelectorAll('.journal-task-card')].find(button => button.textContent.includes('手动修正')).click()")
          await waitForRenderer(journal, "document.querySelector('.journal-detail-panel[open] img') && document.querySelector('.journal-ocr-text pre')")
          if (await journal.webContents.executeJavaScript("document.querySelector('.journal-detail-panel').scrollWidth > document.querySelector('.journal-detail-panel').clientWidth + 1")) throw new Error('Journal detail horizontal overflow')
          writeFileSync(join(directory, `journal-detail-${theme}-${width}.png`), (await journal.webContents.capturePage()).toPNG())
          await journal.webContents.executeJavaScript("document.querySelector('.journal-detail-meta button').click()")
          await waitForRenderer(journal, "document.querySelector('.journal-edit-form input')")
          if (await journal.webContents.executeJavaScript("document.querySelector('.journal-detail-panel').scrollWidth > document.querySelector('.journal-detail-panel').clientWidth + 1")) throw new Error('Journal editor horizontal overflow')
          writeFileSync(join(directory, `journal-edit-${theme}-${width}.png`), (await journal.webContents.capturePage()).toPNG())
          await journal.webContents.executeJavaScript("document.querySelector('.journal-detail-panel header button').click()")
          await journal.webContents.executeJavaScript("document.querySelectorAll('.journal-view-nav button')[2].click()")
          await waitForRenderer(journal, "document.querySelector('.journal-summary-items li')")
        }
      }
    }
    await journal.webContents.executeJavaScript("document.querySelectorAll('.journal-view-nav button')[0].click()")
    // Delete through the actual UI, including its explicit confirmation.
    await journal.webContents.executeJavaScript("document.querySelector('.journal-more').open = true; document.querySelector('.journal-more button').click()")
    await waitForRenderer(journal, "document.querySelector('.journal-delete')")
    await journal.webContents.executeJavaScript("document.querySelector('.journal-delete div button:last-child').click()")
    await waitForRenderer(journal, "!document.querySelector('.journal-timeline') && document.querySelector('.journal-notice')?.textContent.includes('已删除')")
    if ((await request('list', { from, to })).total !== 0) throw new Error('Journal deletion did not persist')
    if ((await request('captures', { from, to })).total || existsSync(job.path)) throw new Error('Journal deletion retained media')
    if (await request('summary', { from, to })) throw new Error('Journal deletion retained derived summary')
    if ((await request('analysisRecords', { from, to })).length) throw new Error('Journal deletion retained AI usage history')
    await request('analysisFinish', { id: usageRecords[0].id, state: 'success' })
    if ((await request('analysisRecords', { from, to })).length) throw new Error('Late AI usage recreated a deleted record')
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
    const singleActivity = await request('sample', { app: 'editor.exe', title: '单条删除测试', at: from + 1 })
    const singleCapture = await request('capture', { ...imagePayload, activityId: singleActivity, at: from + 1 })
    const singleJob = await request('ocrJob', singleCapture.id)
    await new Promise<void>(resolve => { journal!.webContents.once('did-finish-load', () => resolve()); journal!.webContents.reload() })
    await waitForRenderer(journal, "document.querySelector('.app-container')")
    await journal.webContents.executeJavaScript('window.electronAPI.journal.open()')
    await waitForRenderer(journal, "document.querySelector('.journal-task-card')?.textContent.includes('单条删除测试')")
    await journal.webContents.executeJavaScript("document.querySelector('.journal-task-card').click()")
    await waitForRenderer(journal, "document.querySelector('.journal-detail-activities article button:last-child')")
    await journal.webContents.executeJavaScript("document.querySelector('.journal-detail-activities article button:last-child').click()")
    await waitForRenderer(journal, "document.querySelector('.journal-detail-panel .journal-delete')")
    await journal.webContents.executeJavaScript("document.querySelector('.journal-detail-panel .journal-delete div button:last-child').click()")
    await waitForRenderer(journal, "!document.querySelector('.journal-detail-panel')")
    await request('ocrDone', { id: singleCapture.id, text: 'late OCR' })
    if ((await request('list', { from, to })).total || (await request('captures', { from, to })).total || existsSync(singleJob.path)) throw new Error('Single activity deletion retained its media or late OCR')
    for (let index = 0; index < 101; index++) await request('sample', { app: 'editor.exe', title: `分页样例 ${index}`, at: from + index * 1000 })
    const secondPage = await request('list', { from, to, offset: 100 })
    if (secondPage.total !== 101 || secondPage.items.length !== 1) throw new Error('Journal pagination failed')
    if ((await request('tasks', { from, to, offset: 100 })).items.length !== 1) throw new Error('Unorganized task pagination lost raw activity')
    await new Promise<void>(resolve => { journal!.webContents.once('did-finish-load', () => resolve()); journal!.webContents.reload() })
    await waitForRenderer(journal, "document.querySelector('.app-container')")
    await journal.webContents.executeJavaScript('window.electronAPI.journal.open()')
    await waitForRenderer(journal, "document.querySelectorAll('.journal-task-list li').length === 100")
    const verifyScroll = async () => {
      const scrollable = await journal!.webContents.executeJavaScript("(() => { const list=document.querySelector('.journal-list-scroll'); list.scrollTop=80; return list.scrollHeight>list.clientHeight && list.scrollTop>0 && getComputedStyle(list,'::-webkit-scrollbar').width==='8px' })()")
      if (!scrollable) throw new Error('Journal list has no visible independently scrollable scrollbar')
    }
    await verifyScroll()
    await journal.webContents.executeJavaScript("document.querySelector('.journal-mode-switch button:last-child').click()")
    await waitForRenderer(journal, "document.querySelectorAll('.journal-timeline li').length === 100")
    await verifyScroll()
    for (let index = 101; index < 450; index++) await request('sample', { app: 'editor.exe', title: `sample ${index}`, at: from + index * 1000 })
    const sampled = await request('summaryInput', { from, to })
    if (!sampled.truncated || sampled.available !== 450 || sampled.sources[0].at !== from || sampled.sources.at(-1).at !== from + 449000) throw new Error('Journal sampling lost a day boundary')
    await request('deleteRange', { from, to })
    // A fresh connection must read disabled state and deleted records.
    const final = await journal.webContents.executeJavaScript('window.electronAPI.journal.status()')
    if (final.config.enabled || final.lastCapturedAt !== null) throw new Error('Smoke accidentally enabled journal collection')
    console.log(`CHOUYU_JOURNAL_SMOKE_PASSED capture=${syntheticCapture ? 'synthetic-renderer' : 'native-helper-and-WGC'}, fixture recording disabled, SQLite worker, interval merge, Chinese search, pagination, frame dedup, OCR search, image and summary UI, cascading deletion`)
  } finally {
    stopJournalCapture()
    saveConfig(originalConfig)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    main.webContents.send('open-chat-panel')
    await request('close').catch(() => {})
    await worker.terminate()
  }
}
