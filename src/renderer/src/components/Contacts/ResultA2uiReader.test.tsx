// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { sourceSnapshot } from '../../../../shared/result-design'
import ResultA2uiReader from './ResultA2uiReader'

let root: Root | undefined
afterEach(async () => { if (root) await act(async () => root?.unmount()); document.body.replaceChildren() })
it('locates an initial section after the SDK has mounted its child tree', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(document, 'scrollingElement', { configurable: true, value: document.documentElement })
  const source = sourceSnapshot({domain:'contact',ownerId:'a',taskId:'t'},'1','书',[
    {id:'a',title:'第一节',body:'第一节正文',sources:[]},{id:'b',title:'第二节',body:'第二节正文',sources:[]}
  ],[])
  const host=document.createElement('div');document.body.append(host);root=createRoot(host)
  const position=vi.fn()
  await act(async()=>root!.render(<ResultA2uiReader source={source} initialSectionId="b" onReadingPosition={position} onError={()=>{throw Error('unexpected')}}/>))
  await vi.waitFor(()=>expect(document.activeElement?.getAttribute('data-result-section')).toBe('b'))
  expect(position).toHaveBeenLastCalledWith('b',0)
})

it('renders the real SDK surface with full saved sections and local directory navigation', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  // jsdom has no layout viewport; supply the browser's standards-mode scroller.
  Object.defineProperty(document, 'scrollingElement', { configurable: true, value: document.documentElement })
  const source = sourceSnapshot({ domain: 'contact', ownerId: 'author', taskId: 'task' }, '1', '保存的报告', [
    { id: 'a', title: '同名章节', body: '**第一节原文**', sources: [] },
    { id: 'b', title: '同名章节', body: '末尾正文', sources: [] }
  ], [])
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  const onReadingPosition = vi.fn()
  await act(async () => { root!.render(<ResultA2uiReader source={source} onReadingPosition={onReadingPosition} onError={() => { host.dataset.failed = 'true' }} />) })
  await vi.waitFor(() => expect(host.querySelectorAll('[data-reading-section]')).toHaveLength(2))
  expect(host.textContent).toContain('末尾正文')
  expect(host.querySelector('strong')?.textContent).toBe('第一节原文')
  await act(async () => { host.querySelectorAll<HTMLButtonElement>('nav button')[1].click() })
  expect(document.activeElement?.getAttribute('data-reading-section')).toBe('1')
  expect(onReadingPosition).toHaveBeenLastCalledWith('b', 0)
  expect(host.dataset.failed).toBeUndefined()
  const next = sourceSnapshot({ domain: 'contact', ownerId: 'other', taskId: 'task' }, '1', '另一联系人', [
    { id: 'a', title: '另一节', body: '新的固定正文', sources: [] }
  ], [])
  await act(async () => { root!.render(<ResultA2uiReader source={next} onError={() => { host.dataset.failed = 'true' }} />) })
  expect(host.textContent).toContain('新的固定正文')
  expect(host.textContent).not.toContain('末尾正文')
  expect(host.querySelectorAll('[data-reading-section]')).toHaveLength(1)
  expect(host.dataset.failed).toBeUndefined()
})
