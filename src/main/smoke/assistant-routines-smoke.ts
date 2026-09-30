import type { BrowserWindow } from 'electron'
import { getConfig, saveConfig } from '../database'
import { waitForRenderer } from './storage-smoke'
import { snapshots } from './chat-smoke'

export async function runAssistantRoutinesSmoke(window: BrowserWindow) {
  const config = getConfig()
  saveConfig({ proactiveGreeting: false, proactiveRestReminder: false, proactiveReturn: false })
  window.webContents.send('config:changed', getConfig())
  const run = (script: string) => window.webContents.executeJavaScript(script)
  const checkFieldFocus = async () => {
    await run(`(async () => {
      for (const field of document.querySelectorAll('.assistant-routines form input, .assistant-routines form textarea, .assistant-routines form select')) {
        field.blur();
        await new Promise(resolve => setTimeout(resolve, 160));
        const border = getComputedStyle(field).borderColor;
        field.focus();
        await new Promise(resolve => setTimeout(resolve, 160));
        const focused = getComputedStyle(field);
        if (focused.outlineStyle !== 'none' || focused.boxShadow !== 'none' || focused.borderColor !== border) {
          throw new Error('Assistant field focus changed border or added decoration: ' + field.tagName);
        }
      }
      document.querySelector('.assistant-routines textarea').focus();
    })()`)
    await snapshots(window, 'assistant-routine-focused', '.assistant-routines form')
  }
  try {
    window.webContents.send('open-assistant-chat')
    await waitForRenderer(window, "Boolean(document.querySelector('.chat-panel'))")
    await waitForRenderer(window, "Boolean(document.querySelector('[data-contact-work-tab=work]'))")
    await run("document.querySelector('[data-contact-work-tab=work]').click()")
    await waitForRenderer(window, "Boolean(document.querySelector('.assistant-routines button:not(:disabled)'))")
    await waitForRenderer(window, "document.querySelectorAll('[data-assistant-duty]').length === 3 && Boolean(document.querySelector('[data-morning-summary=pending]'))")
    if ((await run('window.electronAPI.assistantRoutines.list()')).length) throw new Error('Built-in duties unexpectedly created schedules')
    if (process.env.CHOUYU_SMOKE_FIELD_FOCUS_ONLY === '1') {
      await run("document.querySelector('[data-morning-summary=pending] button').click()")
      await waitForRenderer(window, "Boolean(document.querySelector('.assistant-routines form'))")
      await checkFieldFocus()
      console.log('CHOUYU_ASSISTANT_FIELD_FOCUS_SMOKE_PASSED unchanged borders/no outline/no glow')
      return
    }
    await run("document.querySelector('[data-assistant-duty=proactiveRestReminder] button').click()")
    await waitForRenderer(window, "document.querySelector('[data-contact-work-tab=work] .contact-work-count')?.textContent === '1'")
    if (!(await run('window.electronAPI.db.getConfig()')).proactiveRestReminder) throw new Error('Duty toggle did not update config')
    await snapshots(window, 'assistant-duties', '.assistant-routines')
    await run("document.querySelector('[data-assistant-duty=proactiveRestReminder] button').click()")
    await waitForRenderer(window, "document.querySelector('[data-assistant-duty=proactiveRestReminder]')?.textContent.includes('已暂停')")
    await run("document.querySelector('[data-morning-summary=pending] button').click()")
    await waitForRenderer(window, "Boolean(document.querySelector('.assistant-routines form'))")
    await checkFieldFocus()
    if (await run("document.querySelector('.assistant-routines input[type=time]').value")) throw new Error('Morning summary must require an explicit time')
    await run("document.querySelector('.assistant-routines form').requestSubmit()")
    if ((await run('window.electronAPI.assistantRoutines.list()')).length) throw new Error('Blank time created a schedule')
    await snapshots(window, 'assistant-routine-form', '.assistant-routines form')
    await snapshots(window, 'assistant-routine-schedule', '.assistant-routines-schedule')
    await run("(() => { const input = document.querySelector('.assistant-routines input[type=time]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '09:00'); input.dispatchEvent(new Event('input', { bubbles: true })) })()")
    await run("document.querySelector('.assistant-routines form').requestSubmit()")
    await waitForRenderer(window, "Boolean(document.querySelector('.assistant-routines article')) && !document.querySelector('.assistant-routines form')")
    const items = await run('window.electronAPI.assistantRoutines.list()')
    if (items.length !== 1 || items[0].kind !== 'contact-summary' || items[0].time !== '09:00') throw new Error('Routine form did not persist')
    await waitForRenderer(window, "document.querySelector('[data-contact-work-tab=work] .contact-work-count')?.textContent === '1'")
    await snapshots(window, 'assistant-routine-saved', '.assistant-routines article')
    await run("[...document.querySelectorAll('.assistant-routines button')].find(b => b.textContent === '暂停').click()")
    await waitForRenderer(window, "document.querySelector('.assistant-routines article')?.textContent.includes('已暂停')")
    await run("[...document.querySelectorAll('.assistant-routines button')].find(b => b.textContent === '修改').click()")
    await run("(() => { const input = document.querySelector('.assistant-routines input[type=time]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '08:30'); input.dispatchEvent(new Event('input', { bubbles: true })) })()")
    await run("document.querySelector('.assistant-routines form').requestSubmit()")
    await waitForRenderer(window, "!document.querySelector('.assistant-routines form') && document.querySelector('.assistant-routines article')?.textContent.includes('08:30')")
    await run('window.electronAPI.assistantRoutines.list().then(items => { if (items.length !== 1 || items[0].enabled) throw new Error("Editing changed pause state"); return true })')
    await run("document.querySelector('[aria-label=\"关闭联系人工作弹窗\"]').click(); document.querySelector('[data-workspace-nav=settings]').click()")
    await waitForRenderer(window, "Boolean(document.querySelector('[data-settings-nav]'))")
    await run("[...document.querySelectorAll('[data-settings-nav]')].find(b => b.textContent.trim() === '通用').click()")
    await waitForRenderer(window, "document.querySelector('#settings-assistant-routines article')?.textContent.includes('08:30')")
    await snapshots(window, 'assistant-routine-settings', '#settings-assistant-routines')
    await run("[...document.querySelectorAll('#settings-assistant-routines button')].find(b => b.textContent === '恢复').click()")
    await waitForRenderer(window, "document.querySelector('#settings-assistant-routines article')?.textContent.includes('已启用')")
    await run("document.querySelector('[data-workspace-nav=chat]').click()")
    await waitForRenderer(window, "document.querySelector('[data-contact-work-tab=work] .contact-work-count')?.textContent === '1'")
    await run("document.querySelector('[data-contact-work-tab=work]').click()")
    await waitForRenderer(window, "document.querySelector('.contact-work-sheet[open] .assistant-routines article')?.textContent.includes('已启用')")
    await run("[...document.querySelectorAll('.contact-work-sheet[open] .assistant-routines button')].find(b => b.textContent === '暂停').click()")
    await waitForRenderer(window, "document.querySelector('.contact-work-sheet[open] .assistant-routines article')?.textContent.includes('已暂停')")
    await window.webContents.reload()
    await waitForRenderer(window, "Boolean(document.querySelector('.pet-container'))")
    const restored = await run('window.electronAPI.assistantRoutines.list()')
    if (restored[0].time !== '08:30' || restored[0].enabled) throw new Error('Reload lost routine settings')
    await run(`window.electronAPI.assistantRoutines.remove(${JSON.stringify(restored[0].id)}, ${restored[0].revision})`)
    console.log('CHOUYU_ASSISTANT_ROUTINES_SMOKE_PASSED built-in duties/config sync/empty schedules/morning template/explicit time/chat task entry/settings sync/live badge/form/save/pause/edit/reload/remove')
  } finally { saveConfig(config); window.webContents.send('config:changed', getConfig()) }
}
