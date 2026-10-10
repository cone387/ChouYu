import { beforeEach, describe, expect, test } from 'vitest'
import { getMouseIgnored, setMouseIgnored, syncMouseEvents, isInteractiveHit } from './mouse-events'

const sent: boolean[] = []
const stateListeners: Array<(ignored: boolean) => void> = []

test('bounded portal hits do not make the native dialog backdrop capture the desktop', () => {
  const bounded = { getBoundingClientRect: () => ({ left: 100, right: 400, top: 200, bottom: 500 }) }
  const element = { closest: (selector: string) => selector === '[data-interactive]' ? element : bounded } as unknown as Element
  expect(isInteractiveHit(element, 150, 250)).toBe(true)
  expect(isInteractiveHit(element, 10, 10)).toBe(false)
  expect(isInteractiveHit(element, 400, 250)).toBe(false)
  expect(isInteractiveHit(element, 150, 500)).toBe(false)
  expect(isInteractiveHit(element, 100, 200)).toBe(true)
  expect(isInteractiveHit(null, 150, 250)).toBe(false)
  expect(isInteractiveHit({ closest: () => null } as unknown as Element, 150, 250)).toBe(false)
  const ordinary = { closest: (selector: string) => selector === '[data-interactive]' ? ordinary : null } as unknown as Element
  expect(isInteractiveHit(ordinary, 150, 250)).toBe(true)
})

beforeEach(() => {
  sent.length = 0
  stateListeners.length = 0
  ;(globalThis as unknown as { window: unknown }).window = {
    electronAPI: {
      setIgnoreMouseEvents: (ignore: boolean) => { sent.push(ignore) },
      onMouseEventsState: (callback: (ignored: boolean) => void) => {
        stateListeners.push(callback)
        return () => { stateListeners.splice(stateListeners.indexOf(callback), 1) }
      }
    }
  }
  for (const listener of [...stateListeners]) listener(true)
})

describe('mouse-events 认知模块', () => {
  test('状态变化才发送 IPC，未变化不发送', () => {
    setMouseIgnored(false)
    expect(sent).toEqual([false])
    expect(getMouseIgnored()).toBe(false)
    setMouseIgnored(false)
    expect(sent).toEqual([false])
    setMouseIgnored(true)
    expect(sent).toEqual([false, true])
  })

  test('主进程广播回写认知（托盘解锁后的再同步）', () => {
    setMouseIgnored(true)
    expect(sent).toEqual([])
    const stop = syncMouseEvents()
    expect(stateListeners).toHaveLength(1)
    for (const listener of stateListeners) listener(false)
    expect(getMouseIgnored()).toBe(false)
    setMouseIgnored(false)
    expect(sent).toEqual([])
    setMouseIgnored(true)
    expect(sent).toEqual([true])
    stop()
    expect(stateListeners).toHaveLength(0)
  })
})
