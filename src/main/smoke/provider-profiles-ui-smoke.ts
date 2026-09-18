import { ipcMain, type BrowserWindow } from 'electron'
import { getConfig, saveConfig } from '../database'
import { getProviderProfiles, MAX_PROVIDER_PROFILES } from '../../shared/config'
import { waitForRenderer } from './storage-smoke'

/** Isolated smoke profile only: exercise load retry, failed-save drafts and confirmation. */
export async function runProviderProfilesUISmoke(window: BrowserWindow): Promise<void> {
  const original = getConfig().providerProfiles
  const run = (source: string) => window.webContents.executeJavaScript(source)
  const click = (selector: string) => run(`document.querySelector(${JSON.stringify(selector)}).click()`)
  const fill = (label: string, value: string) => run(`(() => {
    const input = document.querySelector('[aria-label="' + ${JSON.stringify(label)} + '"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  const assert = async (condition: string) => { if (!await run(condition)) throw new Error(`Provider UI assertion failed: ${condition}`) }
  let failLoad = true
  ipcMain.removeHandler('provider-profiles:list')
  ipcMain.handle('provider-profiles:list', () => {
    if (failLoad) throw new Error('模拟档案加载失败')
    return getProviderProfiles(getConfig())
  })
  try {
    window.webContents.send('open-chat-panel')
    await waitForRenderer(window, "!!document.querySelector('[data-workspace-nav=settings]')")
    await click('[data-workspace-nav="settings"]')
    await run("Array.from(document.querySelectorAll('[data-settings-nav]')).find(button => button.textContent.includes('连接 AI')).click()")
    await waitForRenderer(window, "document.querySelector('.provider-profiles-card [role=alert]')?.textContent.includes('模拟档案加载失败')")
    failLoad = false
    await click('.provider-profiles-card [role="alert"] button')
    await waitForRenderer(window, "!document.querySelector('.provider-profiles-card [role=alert]') && document.querySelector('.provider-profiles-card').getAttribute('aria-busy') === 'false'")
    await click('.provider-profiles-card > .app-button-primary')
    await fill('档案名称', '保存重试验收')
    await fill('档案 Base URL', 'https://example.invalid/v1')
    // Another writer reaches capacity after the draft opens; the failed draft must survive.
    saveConfig({ providerProfiles: Array.from({ length: MAX_PROVIDER_PROFILES }, (_, index) => ({ id: `capacity-${index}`, name: `capacity-${index}`, provider: 'openai', baseUrl: 'https://example.invalid/v1', apiKey: '' })) })
    await click('.provider-profile-form button[type="submit"]')
    await waitForRenderer(window, "document.querySelector('.provider-profiles-card [role=alert]')?.textContent.includes('最多支持')")
    await assert("document.querySelector('[aria-label=档案名称]').value === '保存重试验收' && !document.querySelector('.provider-profile-form button[type=submit]').disabled")
    saveConfig({ providerProfiles: original })
    await click('.provider-profile-form button[type="submit"]')
    await waitForRenderer(window, "!document.querySelector('.provider-profile-form') && document.querySelector('.provider-profiles-card [role=status]')?.textContent === '档案已保存。'")
    await run("Array.from(document.querySelectorAll('.provider-profiles-card li')).find(item => item.textContent.includes('保存重试验收')).querySelector('.app-button-danger').click()")
    await waitForRenderer(window, "!!document.querySelector('.app-confirm-dialog:modal')")
    await click('.app-confirm-dialog button:first-child')
    if (!getConfig().providerProfiles.some(profile => profile.name === '保存重试验收')) throw new Error('Cancel deleted a provider profile')
    await run("Array.from(document.querySelectorAll('.provider-profiles-card li')).find(item => item.textContent.includes('保存重试验收')).querySelector('.app-button-danger').click()")
    await waitForRenderer(window, "!!document.querySelector('.app-confirm-dialog:modal')")
    await click('.app-confirm-dialog .app-button-danger')
    await waitForRenderer(window, "document.querySelector('.provider-profiles-card [role=status]')?.textContent === '档案已删除。'")
    if (getConfig().providerProfiles.some(profile => profile.name === '保存重试验收')) throw new Error('Confirmed deletion was not persisted')
    await click('[data-workspace-nav="chat"]')
    await click('[aria-label="关闭面板"]')
    await waitForRenderer(window, "!document.querySelector('.chat-panel')")
    console.log('CHOUYU_PROVIDER_UI_SMOKE_PASSED load failure/retry, failed-save draft preservation, retry, cancel and confirmed deletion')
  } finally {
    saveConfig({ providerProfiles: original })
    ipcMain.removeHandler('provider-profiles:list')
    ipcMain.handle('provider-profiles:list', () => getProviderProfiles(getConfig()))
  }
}
