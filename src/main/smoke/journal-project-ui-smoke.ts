import type { BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { waitForRenderer } from './storage-smoke'

export async function runJournalProjectUISmoke(window: BrowserWindow, savedId: string, sourceApp: string): Promise<void> {
  const js = (code: string) => window.webContents.executeJavaScript(code)
  const click = (text: string) => js(`[...document.querySelectorAll('.journal-projects button')].find(button=>button.textContent===${JSON.stringify(text)}).click()`)
  const fill = (label: string, value: string) => js(`(() => { const input=document.querySelector('[aria-label='+${JSON.stringify(label)}+']'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)}); input.dispatchEvent(new Event('input',{bubbles:true})) })()`)
  await js("[...document.querySelectorAll('.journal-view-nav button')].find(button=>button.textContent==='项目归档').click()")
  await waitForRenderer(window, "document.querySelector('.journal-projects') && !document.querySelector('.journal-projects [role=status]')")
  await click('新建项目'); await fill('项目名称', '归档界面合成项目'); await click('添加匹配规则')
  await js(`(() => { const input=document.querySelector('.journal-project-rule input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(sourceApp)}); input.dispatchEvent(new Event('input',{bubbles:true})) })()`)
  await click('保存项目')
  await waitForRenderer(window, "!document.querySelector('[aria-label=项目编辑]') && document.querySelector('.journal-projects')?.textContent.includes('建议归属：归档界面合成项目')")
  const projectId = await js("(async () => (await window.electronAPI.journal.projects()).projects.find(project=>project.name==='归档界面合成项目').id)()")
  const card = `[data-project-saved="${savedId}"]`
  const select = (value: string) => js(`(() => { const input=document.querySelector(${JSON.stringify(card + ' select')}); input.value=${JSON.stringify(value)}; input.dispatchEvent(new Event('change',{bubbles:true})) })()`)
  await select('none')
  await waitForRenderer(window, `document.querySelector(${JSON.stringify(card)})?.textContent.includes('手动归属：不归属') && !document.querySelector(${JSON.stringify(card + ' select')}).disabled`)
  await select(projectId)
  await waitForRenderer(window, `document.querySelector(${JSON.stringify(card)})?.textContent.includes('手动归属：归档界面合成项目') && !document.querySelector(${JSON.stringify(card + ' select')}).disabled`)
  await click('编辑项目')
  await js("(() => { const input=document.querySelector('[aria-label=项目说明]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'已修正的项目说明'); input.dispatchEvent(new Event('input',{bubbles:true})) })()")
  await js("document.querySelector('.journal-project-archive input').click()")
  await click('保存项目')
  await waitForRenderer(window, "!document.querySelector('[aria-label=项目编辑]') && document.querySelector('[aria-label=项目列表]')?.textContent.includes('已修正的项目说明') && document.querySelector('[aria-label=项目列表]')?.textContent.includes('已归档')")
  if (!(await js(`document.querySelector(${JSON.stringify(card)})?.textContent.includes('手动归属：归档界面合成项目')`))) throw new Error('Archiving project lost manual assignment')
  await js(`(() => { const input=document.querySelector('[aria-label=筛选收藏归属]'); input.value=${JSON.stringify(projectId)}; input.dispatchEvent(new Event('change',{bubbles:true})) })()`)
  await waitForRenderer(window, `!!document.querySelector(${JSON.stringify(card)})`)
  await js(`document.querySelector(${JSON.stringify(card + ' > button')}).click()`)
  await waitForRenderer(window, `document.querySelector(${JSON.stringify(card + ' img')})`)
  const directory = process.env.CHOUYU_JOURNAL_ARTIFACTS
  if (directory) {
    mkdirSync(directory, { recursive: true })
    const size = window.getSize(), style = await js("document.querySelector('.app-workspace').getAttribute('style')"), theme = await js('document.documentElement.dataset.theme')
    for (const [mode, width] of [['light', 1024], ['dark', 560]] as const) {
      window.setSize(width, 760)
      await js(`document.documentElement.dataset.theme='${mode}'; document.querySelector('.app-workspace').style.width='${width}px'; document.querySelector('.app-workspace').style.maxWidth='${width}px'; document.querySelector(${JSON.stringify(card)}).scrollIntoView({block:'start',behavior:'instant'}); new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
      if (await js("document.querySelector('.journal-projects').scrollWidth > document.querySelector('.journal-projects').clientWidth + 1")) throw new Error('Project UI overflows')
      writeFileSync(join(directory, `journal-projects-${mode}-${width}.png`), (await window.webContents.capturePage()).toPNG())
    }
    window.setSize(size[0], size[1]); await js(`document.querySelector('.app-workspace').setAttribute('style',${JSON.stringify(style || '')}); document.documentElement.dataset.theme=${JSON.stringify(theme)}`)
  }
  await click('删除项目'); await click('确认删除项目')
  await waitForRenderer(window, `document.querySelector(${JSON.stringify(card)})?.textContent.includes('手动归属：不归属') && !document.querySelector('[aria-label=项目列表] h3')`)
  if (!(await js('window.electronAPI.journal.savedItems()')).some((item: { id: string }) => item.id === savedId)) throw new Error('Project deletion removed saved snapshot')
  console.log('CHOUYU_JOURNAL_PROJECT_UI_SMOKE_PASSED create rule, suggestion, manual correction, project filter, snapshot and project deletion')
}
