import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { attachMouseEventsController } from './mouse-events'

type WindowCall = { kind: 'ignore'; ignored: boolean; options: unknown } | { kind: 'send'; channel: string; payload: unknown }

function createFakeWindow() {
  const calls: WindowCall[] = []
  const winListeners = new Map<string, Array<() => void>>()
  const state = { destroyed: false, visible: true }
  const win = {
    isDestroyed: () => state.destroyed,
    isVisible: () => state.visible,
    setIgnoreMouseEvents: (ignored: boolean, options?: { forward: boolean }) => {
      calls.push({ kind: 'ignore', ignored, options })
    },
    getContentBounds: () => ({ x: 100, y: 50, width: 800, height: 600 }),
    on: (event: string, listener: () => void) => {
      const list = winListeners.get(event) ?? []
      list.push(listener)
      winListeners.set(event, list)
    },
    removeListener: (event: string, listener: () => void) => {
      const list = (winListeners.get(event) ?? []).filter(l => l !== listener)
      winListeners.set(event, list)
    },
    webContents: {
      isDestroyed: () => state.destroyed,
      send: (channel: string, payload: unknown) => {
        if (channel === 'mouse-events-state') calls.push({ kind: 'send', channel, payload })
        else if (channel === 'cursor-position') calls.push({ kind: 'send', channel, payload })
      }
    }
  }
  return {
    win, calls, state,
    emitWin: (event: string) => { for (const l of winListeners.get(event) ?? []) l() },
    listenerCount: (event: string) => (winListeners.get(event) ?? []).length
  }
}

function createFakeEnvironment(cursorPositions: Array<{ x: number; y: number }>) {
  const listeners = new Map<string, Array<() => void>>()
  let cursorIndex = 0
  const cursor = { x: 0, y: 0 }
  const environment = {
    platform: 'darwin' as NodeJS.Platform,
    screen: {
      getCursorScreenPoint: () => {
        const next = cursorPositions[Math.min(cursorIndex, cursorPositions.length - 1)]
        cursorIndex++
        cursor.x = next.x
        cursor.y = next.y
        return { ...cursor }
      },
      on: (event: string, listener: () => void) => {
        const list = listeners.get(`screen:${event}`) ?? []
        list.push(listener)
        listeners.set(`screen:${event}`, list)
      },
      removeListener: (event: string, listener: () => void) => {
        const list = (listeners.get(`screen:${event}`) ?? []).filter(l => l !== listener)
        listeners.set(`screen:${event}`, list)
      }
    },
    powerMonitor: {
      on: (event: string, listener: () => void) => {
        const list = listeners.get(`power:${event}`) ?? []
        list.push(listener)
        listeners.set(`power:${event}`, list)
      },
      removeListener: (event: string, listener: () => void) => {
        const list = (listeners.get(`power:${event}`) ?? []).filter(l => l !== listener)
        listeners.set(`power:${event}`, list)
      }
    },
    emit: (scope: 'screen' | 'power', event: string) => {
      for (const l of listeners.get(`${scope}:${event}`) ?? []) l()
    }
  }
  return environment
}

describe('attachMouseEventsController', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  test('挂载即断言穿透（forward 转发）并广播给 renderer', () => {
    const fake = createFakeWindow()
    attachMouseEventsController(fake.win, createFakeEnvironment([{ x: 10, y: 10 }]))
    expect(fake.calls).toContainEqual({ kind: 'ignore', ignored: true, options: { forward: true } })
    expect(fake.calls).toContainEqual({ kind: 'send', channel: 'mouse-events-state', payload: true })
  })

  test('setIgnored(false) 解除穿透且不带 forward 选项，并广播', () => {
    const fake = createFakeWindow()
    const controller = attachMouseEventsController(fake.win, createFakeEnvironment([{ x: 10, y: 10 }]))
    fake.calls.length = 0
    controller.setIgnored(false)
    expect(fake.calls).toContainEqual({ kind: 'ignore', ignored: false, options: undefined })
    expect(fake.calls).toContainEqual({ kind: 'send', channel: 'mouse-events-state', payload: false })
  })

  test('静止时不重复发送，跨过一个像素的边界也发送内容区坐标', () => {
    const fake = createFakeWindow()
    const env = createFakeEnvironment([{ x: 500, y: 300 }, { x: 500, y: 300 }, { x: 501, y: 300 }])
    attachMouseEventsController(fake.win, env)
    fake.calls.length = 0
    vi.advanceTimersByTime(300)
    expect(fake.calls).toContainEqual({ kind: 'send', channel: 'cursor-position', payload: { x: 400, y: 250 } })
    fake.calls.length = 0
    vi.advanceTimersByTime(300)
    expect(fake.calls.filter(c => c.kind === 'send' && c.channel === 'cursor-position')).toHaveLength(0)
    fake.calls.length = 0
    vi.advanceTimersByTime(300)
    expect(fake.calls).toContainEqual({ kind: 'send', channel: 'cursor-position', payload: { x: 401, y: 250 } })
  })

  test('窗口隐藏或销毁时不发送光标，也不应用状态', () => {
    const fake = createFakeWindow()
    const env = createFakeEnvironment([{ x: 500, y: 300 }, { x: 900, y: 700 }])
    const controller = attachMouseEventsController(fake.win, env)
    fake.calls.length = 0
    fake.state.visible = false
    vi.advanceTimersByTime(300)
    expect(fake.calls.filter(c => c.kind === 'send' && c.channel === 'cursor-position')).toHaveLength(0)
    fake.state.visible = true
    fake.state.destroyed = true
    vi.advanceTimersByTime(300)
    expect(fake.calls.filter(c => c.kind === 'send' && c.channel === 'cursor-position')).toHaveLength(0)
    fake.calls.length = 0
    controller.setIgnored(false)
    expect(fake.calls).toHaveLength(0)
  })

  test('电源/显示器事件与窗口 show/restore/focus 重新断言期望状态', () => {
    const fake = createFakeWindow()
    const env = createFakeEnvironment([{ x: 10, y: 10 }])
    const controller = attachMouseEventsController(fake.win, env)
    controller.setIgnored(false)
    fake.calls.length = 0
    env.emit('power', 'resume')
    env.emit('power', 'unlock-screen')
    env.emit('screen', 'display-metrics-changed')
    fake.emitWin('show')
    fake.emitWin('restore')
    fake.emitWin('focus')
    expect(fake.calls.filter(c => c.kind === 'ignore' && c.ignored === false).length).toBeGreaterThanOrEqual(6)
    controller.setIgnored(true)
    fake.calls.length = 0
    env.emit('power', 'resume')
    expect(fake.calls.filter(c => c.kind === 'ignore')).toContainEqual({ kind: 'ignore', ignored: true, options: { forward: true } })
  })

  test('dispose 清理定时器与全部监听', () => {
    const fake = createFakeWindow()
    const env = createFakeEnvironment([{ x: 500, y: 300 }, { x: 900, y: 700 }])
    const controller = attachMouseEventsController(fake.win, env)
    controller.dispose()
    fake.calls.length = 0
    vi.advanceTimersByTime(1200)
    expect(fake.calls.filter(c => c.kind === 'send' && c.channel === 'cursor-position')).toHaveLength(0)
    expect(fake.listenerCount('show')).toBe(0)
    expect(fake.listenerCount('restore')).toBe(0)
    expect(fake.listenerCount('focus')).toBe(0)
    expect(fake.listenerCount('closed')).toBe(0)
    controller.dispose()
    controller.setIgnored(false)
    env.emit('power', 'resume')
    env.emit('screen', 'display-metrics-changed')
    expect(fake.calls).toHaveLength(0)
  })

  test('Windows never enables the global mouse hook, including after resume', () => {
    const fake = createFakeWindow()
    const env = createFakeEnvironment([{ x: 500, y: 300 }])
    const controller = attachMouseEventsController(fake.win, { ...env, platform: 'win32' })
    controller.setIgnored(false)
    controller.setIgnored(true)
    env.emit('power', 'resume')
    expect(fake.calls.filter(c => c.kind === 'ignore' && c.ignored)).toEqual([
      { kind: 'ignore', ignored: true, options: { forward: false } },
      { kind: 'ignore', ignored: true, options: { forward: false } },
      { kind: 'ignore', ignored: true, options: { forward: false } }
    ])
  })

  test('Windows polling detects entry within 75ms without forwarding', () => {
    const fake = createFakeWindow()
    attachMouseEventsController(fake.win, { ...createFakeEnvironment([{ x: 500, y: 300 }]), platform: 'win32' })
    fake.calls.length = 0
    vi.advanceTimersByTime(74)
    expect(fake.calls).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(fake.calls).toEqual([{ kind: 'send', channel: 'cursor-position', payload: { x: 400, y: 250 } }])
    fake.calls.length = 0
    vi.advanceTimersByTime(60_000)
    expect(fake.calls).toHaveLength(0)
  })

  test('repeated desired states do not repeat native calls', () => {
    const fake = createFakeWindow()
    const controller = attachMouseEventsController(fake.win, createFakeEnvironment([{ x: 0, y: 0 }]))
    fake.calls.length = 0
    controller.setIgnored(true)
    expect(fake.calls).toHaveLength(0)
    controller.setIgnored(false)
    fake.calls.length = 0
    controller.setIgnored(false)
    expect(fake.calls).toHaveLength(0)
  })

  test('lock pauses polling and unlock/show rechecks a stationary cursor', () => {
    const fake = createFakeWindow()
    const env = createFakeEnvironment([{ x: 500, y: 300 }])
    attachMouseEventsController(fake.win, env)
    vi.advanceTimersByTime(300)
    fake.calls.length = 0
    env.emit('power', 'lock-screen')
    vi.advanceTimersByTime(3000)
    expect(fake.calls).toHaveLength(0)
    env.emit('power', 'unlock-screen')
    expect(fake.calls).toContainEqual({ kind: 'send', channel: 'cursor-position', payload: { x: 400, y: 250 } })
    fake.calls.length = 0
    fake.emitWin('show')
    expect(fake.calls).toContainEqual({ kind: 'send', channel: 'cursor-position', payload: { x: 400, y: 250 } })
  })

  test('moving the window updates coordinates even when the mouse is stationary', () => {
    const fake = createFakeWindow()
    attachMouseEventsController(fake.win, createFakeEnvironment([{ x: 500, y: 300 }]))
    vi.advanceTimersByTime(300)
    fake.calls.length = 0
    fake.win.getContentBounds = () => ({ x: 200, y: 100, width: 800, height: 600 })
    vi.advanceTimersByTime(300)
    expect(fake.calls).toEqual([{ kind: 'send', channel: 'cursor-position', payload: { x: 300, y: 200 } }])
  })
})
