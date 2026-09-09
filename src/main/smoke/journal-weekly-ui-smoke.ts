import { app, dialog, type BrowserWindow } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { weeklyDate } from '../../shared/journal-weekly'
import { waitForRenderer } from './storage-smoke'

export async function runJournalWeeklyUISmoke(window: BrowserWindow, savedId: string): Promise<void> {
  const js = (code: string) => window.webContents.executeJavaScript(code)
  const click = (text: string) => js(`[...document.querySelectorAll('.journal-weekly button')].find(button=>button.textContent===${JSON.stringify(text)}).click()`)
  const fill = (label: string, value: string) => js(`(() => { const input=document.querySelector('[aria-label='+${JSON.stringify(label)}+']'); Object.getOwnPropertyDescriptor(input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)}); input.dispatchEvent(new Event('input',{bubbles:true})) })()`)
  const saved = await js(`(async () => (await window.electronAPI.journal.savedItems()).find(item=>item.id===${JSON.stringify(savedId)}))()`)
  await js("[...document.querySelectorAll('.journal-view-nav button')].find(button=>button.textContent==='周报草稿').click()")
  await waitForRenderer(window, "document.querySelector('.journal-weekly') && !document.querySelector('.journal-weekly [role=status]')")
  await fill('周报起始日期', weeklyDate(saved.task.startedAt))
  await waitForRenderer(window, `document.querySelector('[data-weekly-source="${savedId}"]')`)
  await js(`document.querySelector('[data-weekly-source="${savedId}"]').click()`)
  await click('确认所选事项并生成新草稿')
  await waitForRenderer(window, "document.querySelector('[aria-label=周报编辑]') && document.querySelector('[data-weekly-id]')")
  const generated = await js("document.querySelector('[aria-label=周报正文]').value")
  if (!generated.includes('## 未完成与下一步') || !generated.includes(savedId) || !generated.includes('不代表完成日期或精确工时')) throw new Error('Weekly UI generated unsupported completion or omitted provenance')
  await fill('周报标题', '合成周报已核对'); await fill('周报正文', `${generated}\n\n个人确认：下周继续验证连接。`)
  if (!(await js("[...document.querySelectorAll('.journal-weekly button')].find(button=>button.textContent==='导出周报 Markdown').disabled"))) throw new Error('Weekly exported unsaved editor changes')
  await click('保存周报修改')
  await waitForRenderer(window, "document.querySelector('[data-weekly-id] h4')?.textContent==='合成周报已核对' && ![...document.querySelectorAll('.journal-weekly button')].find(button=>button.textContent==='导出周报 Markdown').disabled")
  await click('预览周报 Markdown')
  if (!(await js("document.querySelector('.journal-weekly pre').textContent.includes('下周继续验证连接')"))) throw new Error('Weekly preview omitted saved edits')
  await js("[...document.querySelectorAll('.journal-weekly button')].find(button=>button.textContent.startsWith('回看周报来源：')).click()")
  await waitForRenderer(window, "document.querySelector('[aria-label=周报来源回看] img')")
  const directory = process.env.CHOUYU_JOURNAL_ARTIFACTS
  if (directory) {
    mkdirSync(directory, { recursive: true })
    const size = window.getSize(), style = await js("document.querySelector('.app-workspace').getAttribute('style')"), theme = await js('document.documentElement.dataset.theme')
    try {
      for (const [mode, width] of [['light', 1024], ['dark', 560]] as const) {
        window.setSize(width, 760)
        await js(`document.documentElement.dataset.theme='${mode}'; document.querySelector('.app-workspace').style.width='${width}px'; document.querySelector('.app-workspace').style.maxWidth='${width}px'; document.querySelector('[aria-label=周报编辑]').scrollIntoView({block:'start',behavior:'instant'}); new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
        if (await js("document.querySelector('.journal-weekly').scrollWidth > document.querySelector('.journal-weekly').clientWidth + 1")) throw new Error('Weekly UI overflows')
        writeFileSync(join(directory, `journal-weekly-${mode}-${width}.png`), (await window.webContents.capturePage()).toPNG())
      }
    } finally { window.setSize(size[0], size[1]); await js(`document.querySelector('.app-workspace').setAttribute('style',${JSON.stringify(style || '')}); document.documentElement.dataset.theme=${JSON.stringify(theme)}`) }
  }
  const originalDialog = dialog.showSaveDialog, destination = join(app.getPath('userData'), 'weekly-ui-export.md')
  try {
    Object.assign(dialog, { showSaveDialog: async () => ({ canceled: true }) })
    await click('导出周报 Markdown')
    await waitForRenderer(window, "document.querySelector('.journal-weekly [role=status]')?.textContent==='已取消周报导出。'")
    Object.assign(dialog, { showSaveDialog: async () => ({ canceled: false, filePath: destination }) })
    await click('导出周报 Markdown')
    await waitForRenderer(window, "document.querySelector('.journal-weekly [role=status]')?.textContent==='周报 Markdown 已导出。'")
    const exported = readFileSync(destination, 'utf8')
    if (!exported.includes('下周继续验证连接') || !exported.includes(savedId)) throw new Error('Weekly export omitted user edits or source')
    const report = await js('(async () => (await window.electronAPI.journal.weekly())[0])()')
    Object.assign(dialog, { showSaveDialog: async () => { await js(`window.electronAPI.journal.editWeekly(${JSON.stringify({ ...report, title: '导出时变更的周报' })})`); return { canceled: false, filePath: destination } } })
    if (!(await js(`window.electronAPI.journal.exportWeekly(${JSON.stringify({ id: report.id, revision: report.revision })}).then(()=>false,()=>true)`)) || readFileSync(destination, 'utf8') !== exported) throw new Error('Stale weekly export overwrote file')
  } finally { dialog.showSaveDialog = originalDialog }
  await click('放弃未保存修改并关闭'); await click('刷新周报与来源')
  await waitForRenderer(window, "document.querySelector('[data-weekly-id] h4')?.textContent==='导出时变更的周报' && ![...document.querySelectorAll('.journal-weekly button')].find(button=>button.textContent==='删除周报').disabled")
  await click('删除周报'); await click('确认删除周报')
  await waitForRenderer(window, "!document.querySelector('[data-weekly-id]')")
  if (!(await js('window.electronAPI.journal.savedItems()')).some((item: { id: string }) => item.id === savedId)) throw new Error('Weekly deletion removed saved source')
  console.log('CHOUYU_JOURNAL_WEEKLY_UI_SMOKE_PASSED source selection, generation, editing, source snapshot, Markdown export/cancel, stale export and deletion')
}
