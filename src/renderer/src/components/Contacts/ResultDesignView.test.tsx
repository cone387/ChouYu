// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { sourceSnapshot, type DesignView } from '../../../../shared/result-design'
import ResultDesignView from './ResultDesignView'

vi.mock('./ResultA2uiReader', () => ({ default: ({ source }: any) => <div data-result-a2ui>{source.title}</div> }))
let root: Root | undefined
afterEach(async () => { if(root) await act(async () => root!.unmount()); document.body.replaceChildren(); vi.restoreAllMocks() })
const source = sourceSnapshot({ domain: 'contact', ownerId: 'author', taskId: 'task' }, '1', '可直接阅读的成果', [{ id: 'one', title: '正文', body: '完整正文', sources: [] }], [])
async function setup(get = vi.fn(async (): Promise<DesignView> => ({ source, hasUpdate: false })), forcePlain = false) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  Object.assign(window, { electronAPI: { resultDesign: { get, onChanged: () => () => {} } } })
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root!.render(<ResultDesignView task={source.ref} forcePlain={forcePlain}><p>原文内容</p></ResultDesignView>))
  return host
}
it('shows adaptive reading on first open without requiring a mode click', async () => {
  const host = await setup()
  await vi.waitFor(() => expect(host.querySelector('[data-result-a2ui]')?.textContent).toBe(source.title))
  const plain = [...host.querySelectorAll('button')].find(b => b.textContent === '原文')!
  await act(async () => plain.click())
  expect(host.querySelector('[data-result-a2ui]')).toBeNull()
  await act(async () => document.dispatchEvent(new Event('visibilitychange')))
  expect(host.querySelector('[data-result-a2ui]')).toBeNull()
})
it('does not override an anchored original-text request with the first async response', async () => {
  const host = await setup(undefined, true)
  expect(host.querySelector('[data-result-a2ui]')).toBeNull()
  expect(host.textContent).toContain('完整正文')
})
