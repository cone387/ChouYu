import { beforeEach, describe, expect, test } from 'vitest'
import { getMouseIgnored, setMouseIgnored, syncMouseEvents } from './mouse-events'

const sent: boolean[] = []
const stateListeners: Array<(ignored: boolean) => void> = []

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
