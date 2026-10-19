import { app, dialog, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { contactSkillLibrary, contactSkillRunner } from '../skills'
import { skillToolRuntime } from '../skills/tools'
import { ContactTaskStore } from '../task-center/contact-store'
import { waitForRenderer } from './storage-smoke'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { DEFAULT_CHARACTER_ID } from '../../shared/characters'

export async function runContactCapabilitySmoke(window: BrowserWindow, owner: string) {
  const run = (code: string) => window.webContents.executeJavaScript(code)
  const click = async (selector: string) => {
    const point = await run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw Error('Missing capability control '+${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);if(!e.contains(document.elementFromPoint(x,y)))throw Error('Capability control covered');return {x,y}})()`)
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point }); window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
  }
  const root = join(app.getPath('userData'), 'capability-fixture'); mkdirSync(root)
  writeFileSync(join(root, 'SKILL.md'), '---\nname: 输出整理\ndescription: 按原文整理摘要。\n---\n# Examples\n- 请把提供的会议记录整理成摘要。\n')
  const library = contactSkillLibrary(), runner = contactSkillRunner()
  library.publish('output-fixture', root); library.configure(owner, 'output-fixture', 'enable', library.list(owner).revision)
  await run(`window.electronAPI.agents.save(${JSON.stringify(owner)},${JSON.stringify({ ...DEFAULT_AGENT_SETTINGS, goal: 'File test', enabled: false })})`)
  const store = new ContactTaskStore(join(app.getPath('userData'), 'contact-agents', 'agents.db'))
  try {
    const before = store.topics.list(owner).length
    await click('[data-agent-tab=skills]'); await waitForRenderer(window, "Boolean(document.querySelector('[data-skill-library]'))"); await click('[data-skill-library]')
    await waitForRenderer(window, "Boolean(document.querySelector('[data-skill-id=output-fixture]'))")
    await click('[data-skill-id=output-fixture] .skill-actions button:first-child')
    await waitForRenderer(window, "Boolean(document.querySelector('[data-skill-example]'))"); await click('[data-skill-example]')
    await waitForRenderer(window, "document.querySelector('dialog [data-task-description]')?.value.includes('会议记录')")
    if (store.topics.list(owner).length !== before) throw new Error('Selecting a skill example implicitly created a task')
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await waitForRenderer(window, "!document.querySelector('dialog[open]')")
    const topic = store.topics.create(owner, { title: '文件成果验收', goal: 'Write files', constraints: '' }, 'user'), runId = store.createRun(owner, '', Date.now(), topic.id)
    const snapshot = library.snapshot(owner), runtime = skillToolRuntime(owner, snapshot, runner, new AbortController().signal, async (skillId, files) => store.files.archive({ characterId: owner, skillId, topicId: topic.id, runId, requestId: runId }, files))
    const write = async (name: string, content: string) => JSON.parse((await runtime.executeResult({ id: name, name: 'write_skill_file', arguments: JSON.stringify({ skillId: 'output-fixture', path: name, content }) })).content).files[0]
    const text = await write('summary.md', '归档第一版：保留真实正文。'), html = await write('report.html', '<h1>静态报告</h1><script>parent.__filePreviewEscape=true</script><a href="https://preview-escape.invalid/">链接</a><img src="https://preview-escape.invalid/image"><p>可安全阅读的正文</p>')
    const [image] = store.files.archive({ characterId: owner, skillId: 'output-fixture', topicId: topic.id, runId, requestId: runId }, [{ name: 'pixel.png', bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=', 'base64') }])
    runner.writeFile(owner, snapshot, 'output-fixture', 'summary.md', '工作目录里的后续改写')
    runner.writeFile(owner, snapshot, 'output-fixture', 'legacy.txt', '没有历史任务归属的文件')
    store.finish(runId, { runId, title: '报告', body: '报告正文', nextStep: 'Continue', evidence: [], createdAt: Date.now() }, [], { status: 'researching', judgement: 'Saved', reason: 'Saved', nextStep: 'Continue', openQuestions: '' }, { completionCriteria: 'Write files', stages: [{ id: 'write', title: '写作', status: 'active' }], summary: 'Saved', section: { id: 'text', title: '报告', body: '正式保存了报告与摘要文件。' }, fileIds: [text.id, html.id] })
    await click('[data-agent-tab=portfolio]'); await waitForRenderer(window, `Boolean(document.querySelector('[data-contact-file="${text.id}"]'))`)
    await waitForRenderer(window, "document.querySelector('[data-contact-files]')?.textContent.includes('历史工作文件')")
    await click(`[data-contact-file="${text.id}"]`); await waitForRenderer(window, "document.querySelector('[data-contact-file-reader] pre')?.textContent.includes('归档第一版')")
    const screenshots = join(process.cwd(), 'artifacts', 'contact-files'); mkdirSync(screenshots, { recursive: true })
    for (const theme of ['light', 'dark']) for (const width of [375, 1024]) {
      await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`)
      window.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width, height: 768 }, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 1, viewSize: { width, height: 768 }, scale: 1 })
      await waitForRenderer(window, `innerWidth===${width} && document.querySelector('[data-contact-file-reader] pre')?.textContent.includes('归档第一版')`)
      await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      await window.webContents.capturePage()
      writeFileSync(join(screenshots, `${theme}-${width}.png`), (await window.webContents.capturePage()).toPNG())
    }
    window.webContents.disableDeviceEmulation(); await run("document.documentElement.dataset.theme='light'")
    const original = dialog.showSaveDialog, target = join(root, 'export.md')
    try {
      dialog.showSaveDialog = (async () => ({ canceled: true, filePath: '' })) as typeof original
      await click('[data-contact-file-export]'); await waitForRenderer(window, "document.querySelector('[data-contact-file-reader] [role=status]')?.textContent.includes('取消')")
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: target })) as typeof original
      await click('[data-contact-file-export]'); await waitForRenderer(window, "document.querySelector('[data-contact-file-reader] [role=status]')?.textContent.includes('已导出')")
      if (readFileSync(target, 'utf8') !== '归档第一版：保留真实正文。') throw new Error('Export read changed workspace bytes')
    } finally { dialog.showSaveDialog = original }
    await click('[data-contact-file-reader] footer button:first-child'); await waitForRenderer(window, "!document.querySelector('[data-contact-file-reader]')")
    await click(`[data-contact-file="${html.id}"]`); await waitForRenderer(window, "Boolean(document.querySelector('[data-contact-file-reader] iframe'))")
    await new Promise(resolve => setTimeout(resolve, 100))
    const frame = window.webContents.mainFrame.frames.find(frame => frame.url === 'about:srcdoc')
    if (!frame || !await frame.executeJavaScript("document.body.textContent.includes('静态报告') && !document.querySelector('a[href],img[src],script:not([nonce])')")) throw new Error('HTML preview did not strip navigation or untrusted executable content')
    if (await run('Boolean(window.__filePreviewEscape)')) throw new Error('HTML preview accessed the host')
    if (!await run(`window.electronAPI.agents.readContactFile(${JSON.stringify(DEFAULT_CHARACTER_ID)},${JSON.stringify(text.id)}).then(()=>false,()=>true)`)) throw new Error('Foreign contact could read archived bytes')
    await click('[data-contact-file-reader] footer button:first-child')
    await waitForRenderer(window, "!document.querySelector('[data-contact-file-reader]')")
    await click(`[data-contact-file="${image.id}"]`); await waitForRenderer(window, "document.querySelector('[data-contact-file-reader] img')?.naturalWidth===1")
    await click('[data-contact-file-reader] footer button:first-child'); await waitForRenderer(window, "!document.querySelector('[data-contact-file-reader]')")
    store.db.prepare('UPDATE contact_file_bytes SET body=? WHERE hash=?').run(Buffer.from('corrupt fixture'), image.hash)
    await click(`[data-contact-file="${image.id}"]`); await waitForRenderer(window, "document.querySelector('[data-contact-file-reader] [role=alert]')?.textContent.includes('校验失败')")
    await click('[data-contact-file-reader] footer button:first-child')
    console.log('CHOUYU_CONTACT_CAPABILITY_SMOKE_PASSED example without execution, actual tool files, old bytes, historical labels, safe HTML, export/cancel and ownership')
  } finally { store.close() }
}
