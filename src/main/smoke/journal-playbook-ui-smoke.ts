import { app, dialog, type BrowserWindow } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { waitForRenderer } from './storage-smoke'
import { getConfig, saveConfig } from '../database'
import { createMemory, getMemoryProvider } from '../memory/service'

export async function runJournalPlaybookUISmoke(window: BrowserWindow, savedId: string): Promise<void> {
  const js = (code: string) => window.webContents.executeJavaScript(code)
  const click = (text: string) => js(`[...document.querySelectorAll('.journal-playbook button')].find(button=>button.textContent===${JSON.stringify(text)}).click()`)
  const fill = (label: string, value: string) => js(`(() => { const input=document.querySelector('[aria-label='+${JSON.stringify(label)}+']'); Object.getOwnPropertyDescriptor(input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)}); input.dispatchEvent(new Event('input',{bubbles:true})) })()`)
  const select = (label: string, value: string) => js(`(() => { const input=document.querySelector('[aria-label='+${JSON.stringify(label)}+']'); input.value=${JSON.stringify(value)}; input.dispatchEvent(new Event('change',{bubbles:true})) })()`)
  await js("[...document.querySelectorAll('.journal-view-nav button')].find(button=>button.textContent==='踩坑手册').click()")
  await waitForRenderer(window, "document.querySelector('.journal-playbook') && !document.querySelector('.journal-playbook [role=status]')")
  await click('新建手册')
  await fill('手册标题', '合成排错经验'); await fill('手册问题', '合成服务连接失败')
  await fill('手册尝试过程', '核对配置与日志'); await fill('手册解决办法', '修正合成地址后连接成功')
  await select('手册状态', 'resolved')
  await js(`document.querySelector('[data-playbook-source="${savedId}"]').click()`)
  await click('保存手册')
  await waitForRenderer(window, "!document.querySelector('[aria-label=手册编辑]') && document.querySelector('[data-playbook-id]')?.textContent.includes('手动标记已解决')")
  await click('编辑手册'); await fill('手册尝试过程', '核对配置与日志，再验证连接'); await click('保存手册')
  await waitForRenderer(window, "!document.querySelector('[aria-label=手册编辑]') && document.querySelector('[data-playbook-id]')?.textContent.includes('再验证连接')")
  const memoryConfig = getConfig()
  saveConfig({ memoryEnabled: true, memoryEngineProvider: 'chouyu-sqlite', embeddingEnabled: false })
  try {
    await click('整理为长期记忆')
    await fill('手册记忆摘要', '合成排错手册：连接失败时核对服务地址，再验证连接。')
    const before = getMemoryProvider().stats()
    await click('预览保存位置')
    await waitForRenderer(window, "document.querySelector('[aria-label=手册记忆确认]')?.textContent.includes('本机长期记忆库')")
    if (process.env.CHOUYU_JOURNAL_ARTIFACTS) {
      mkdirSync(process.env.CHOUYU_JOURNAL_ARTIFACTS, { recursive: true })
      await js("document.querySelector('[aria-label=手册记忆确认]').scrollIntoView({block:'start',behavior:'instant'}); new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))")
      writeFileSync(join(process.env.CHOUYU_JOURNAL_ARTIFACTS, 'journal-playbook-memory-confirm.png'), (await window.webContents.capturePage()).toPNG())
    }
    if (JSON.stringify(getMemoryProvider().stats()) !== JSON.stringify(before)) throw new Error('Memory preview wrote data')
    await click('取消写入')
    if (JSON.stringify(getMemoryProvider().stats()) !== JSON.stringify(before)) throw new Error('Memory cancellation wrote data')
    await click('整理为长期记忆'); await fill('手册记忆摘要', '合成排错手册：连接失败时核对服务地址，再验证连接。')
    await click('预览保存位置')
    await waitForRenderer(window, "[...document.querySelectorAll('.journal-playbook button')].some(button=>button.textContent==='确认写入长期记忆' && !button.disabled)")
    await click('确认写入长期记忆')
    await waitForRenderer(window, "document.querySelector('.journal-playbook-memory')?.textContent.includes('记忆已保存')")
    const memory = getMemoryProvider().list({ query: '合成排错手册', status: 'all' }).find(value => value.content.startsWith('合成排错手册：'))
    const entryId = await js("document.querySelector('[data-playbook-id]').dataset.playbookId")
    if (!memory || memory.status !== 'active' || memory.sourceMessageId !== entryId) throw new Error('Playbook memory content or provenance missing')
    const candidate = { type: 'workflow' as const, content: '合成手册待处理冲突：服务地址需要重新核对。', importance: 0.75, confidence: 1, sensitivity: 'normal' as const }
    const pending = getMemoryProvider().createCandidate(candidate)!
    getMemoryProvider().createConflict(pending.id, memory.id, 'update', '合成测试保留审核')
    const retried = await createMemory(candidate)
    if (retried.status !== 'pending' || !retried.conflicts?.some(value => value.status === 'pending')) throw new Error('Duplicate memory bypassed conflict review')
    await click('整理为长期记忆'); await fill('手册记忆摘要', candidate.content); await click('预览保存位置')
    await waitForRenderer(window, "[...document.querySelectorAll('.journal-playbook button')].some(button=>button.textContent==='确认写入长期记忆' && !button.disabled)")
    await click('确认写入长期记忆')
    await waitForRenderer(window, "document.querySelector('.journal-playbook-memory')?.textContent.includes('已进入记忆待处理列表')")
    getMemoryProvider().delete(pending.id); getMemoryProvider().delete(memory.id)
  } finally { saveConfig(memoryConfig) }
  await click('预览 Markdown')
  if (!(await js("document.querySelector('.journal-playbook-preview').textContent.includes('# 合成排错经验')"))) throw new Error('Playbook Markdown preview missing')
  await js("[...document.querySelectorAll('.journal-playbook button')].find(button=>button.textContent.startsWith('回看来源：')).click()")
  await waitForRenderer(window, "document.querySelector('.journal-playbook img')")
  const directory = process.env.CHOUYU_JOURNAL_ARTIFACTS
  if (directory) {
    mkdirSync(directory, { recursive: true })
    const size = window.getSize(), style = await js("document.querySelector('.app-workspace').getAttribute('style')"), theme = await js('document.documentElement.dataset.theme')
    try {
      for (const [mode, width] of [['light', 1024], ['dark', 560]] as const) {
        window.setSize(width, 760)
        await js(`document.documentElement.dataset.theme='${mode}'; document.querySelector('.app-workspace').style.width='${width}px'; document.querySelector('.app-workspace').style.maxWidth='${width}px'; document.querySelector('[data-playbook-id]').scrollIntoView({block:'start',behavior:'instant'}); new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
        if (await js("document.querySelector('.journal-playbook').scrollWidth > document.querySelector('.journal-playbook').clientWidth + 1")) throw new Error('Playbook UI overflows')
        writeFileSync(join(directory, `journal-playbook-${mode}-${width}.png`), (await window.webContents.capturePage()).toPNG())
      }
    } finally {
      window.setSize(size[0], size[1])
      await js(`document.querySelector('.app-workspace').setAttribute('style',${JSON.stringify(style || '')}); document.documentElement.dataset.theme=${JSON.stringify(theme)}`)
    }
  }
  await select('筛选手册项目', 'none')
  await fill('搜索手册', '不匹配的检索词')
  await waitForRenderer(window, "!document.querySelector('[data-playbook-id]')")
  await fill('搜索手册', '再验证连接')
  await waitForRenderer(window, "document.querySelector('[data-playbook-id]')")
  const originalDialog = dialog.showSaveDialog
  const destination = join(app.getPath('userData'), 'playbook-ui-export.md')
  try {
    Object.assign(dialog, { showSaveDialog: async () => ({ canceled: true }) })
    await click('导出 Markdown')
    await waitForRenderer(window, "document.querySelector('.journal-playbook [role=status]')?.textContent==='已取消导出。'")
    Object.assign(dialog, { showSaveDialog: async () => ({ canceled: false, filePath: destination }) })
    await click('导出 Markdown')
    await waitForRenderer(window, "document.querySelector('.journal-playbook [role=status]')?.textContent==='Markdown 已导出。'")
    const exported = readFileSync(destination, 'utf8')
    if (!exported.includes('再验证连接') || !exported.includes(savedId) || !exported.includes('修正合成地址')) throw new Error('Playbook export omitted content or source')
    const entry = await js('(async () => (await window.electronAPI.journal.playbook())[0])()')
    Object.assign(dialog, { showSaveDialog: async () => {
      await js(`window.electronAPI.journal.savePlaybook(${JSON.stringify({ ...entry, title: '导出期间被修改' })})`)
      return { canceled: false, filePath: destination }
    } })
    const rejected = await js(`window.electronAPI.journal.exportPlaybook(${JSON.stringify({ id: entry.id, revision: entry.revision })}).then(()=>false,()=>true)`)
    if (!rejected || readFileSync(destination, 'utf8') !== exported) throw new Error('Stale export overwrote file')
  } finally { dialog.showSaveDialog = originalDialog }
  await fill('搜索手册', ''); await click('刷新手册')
  await waitForRenderer(window, "document.querySelector('[data-playbook-id] h3')?.textContent==='导出期间被修改' && ![...document.querySelectorAll('.journal-playbook button')].find(button=>button.textContent==='刷新手册').disabled")
  await click('删除手册'); await click('确认删除手册')
  await waitForRenderer(window, "!document.querySelector('[data-playbook-id]')")
  if (!(await js('window.electronAPI.journal.savedItems()')).some((item: { id: string }) => item.id === savedId)) throw new Error('Playbook deletion removed source')
  console.log('CHOUYU_JOURNAL_PLAYBOOK_UI_SMOKE_PASSED edit, source snapshot, filters, Markdown preview/export/cancel, stale export and independent deletion')
}
