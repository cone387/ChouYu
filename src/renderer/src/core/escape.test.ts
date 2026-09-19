import { afterEach, expect, it, vi } from 'vitest'
import { initEscapeInteractions, isOverlayEscape } from './escape'

afterEach(() => vi.unstubAllGlobals())

function setup() {
  class Control {
    isContentEditable = false
    constructor(public editable = false) {}
    matches(selector: string) { return selector === 'input, textarea, select' ? this.editable : true }
    blur = vi.fn()
  }
  class Overlay {
    isConnected = true
    open = true
    child: unknown
    matches() { return this.open }
    getClientRects() { return this.open ? [{}] : [] }
    contains(target: unknown) { return target === this.child }
  }
  const target = new EventTarget()
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrame = 0
  const opener = new Control()
  const overlay = new Overlay()
  const doc = { activeElement: opener, querySelectorAll: () => [overlay] }
  vi.stubGlobal('HTMLElement', Control)
  vi.stubGlobal('document', doc)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal('window', {
    addEventListener: (type: string, listener: EventListener) => target.addEventListener(type, listener),
    removeEventListener: (type: string, listener: EventListener) => target.removeEventListener(type, listener)
  })
  const dispose = initEscapeInteractions()
  const key = (key = 'Escape') => {
    const event = Object.assign(new Event('keydown'), { key }) as KeyboardEvent
    target.dispatchEvent(event)
    return event
  }
  const tick = () => {
    const callbacks = [...frames.values()]
    frames.clear()
    callbacks.forEach(callback => callback(0))
  }
  return { Control, Overlay, target, doc, overlay, opener, dispose, key, tick }
}

it('remembers an overlay after removal, without consuming the next Escape', () => {
  const s = setup()
  const first = s.key()
  s.overlay.isConnected = false
  expect(isOverlayEscape(first)).toBe(true)
  expect(isOverlayEscape(s.key())).toBe(false)
  s.dispose()
})

it('clears focus retained on the opener without a focusin event (contact details)', () => {
  const s = setup()
  s.key()
  s.overlay.isConnected = false
  s.tick()
  expect(s.opener.blur).toHaveBeenCalledOnce()
  s.dispose()
})

it('clears deferred focus restoration after closing a dialog', () => {
  const s = setup()
  s.doc.activeElement = new s.Control(true)
  s.key()
  s.overlay.isConnected = false
  s.tick()
  s.doc.activeElement = s.opener
  s.target.dispatchEvent(new Event('focusin'))
  expect(s.opener.blur).toHaveBeenCalledOnce()
  s.dispose()
})

it('clears a nested picker trigger while its parent dialog remains open', () => {
  const s = setup()
  const parent = new s.Overlay()
  parent.child = s.opener
  s.doc.querySelectorAll = () => [parent, s.overlay]
  s.key()
  s.overlay.open = false
  s.tick()
  expect(s.opener.blur).toHaveBeenCalledOnce()
  s.dispose()
})

it('keeps focus while a busy dialog stays open and preserves text input focus', () => {
  const s = setup()
  s.key()
  s.tick()
  expect(s.opener.blur).not.toHaveBeenCalled()
  const input = new s.Control(true)
  s.doc.activeElement = input
  s.overlay.isConnected = false
  s.tick()
  expect(input.blur).not.toHaveBeenCalled()
  s.dispose()
})

it.each(['Tab', 'pointerdown', 'dispose'])('stops suppressing focus after %s', action => {
  const s = setup()
  s.key()
  s.overlay.isConnected = false
  if (action === 'Tab') s.key('Tab')
  else if (action === 'pointerdown') s.target.dispatchEvent(new Event('pointerdown'))
  else s.dispose()
  s.target.dispatchEvent(new Event('focusin'))
  s.tick()
  expect(s.opener.blur).not.toHaveBeenCalled()
  s.dispose()
})

it('ignores hidden layers and other keys', () => {
  const s = setup()
  expect(isOverlayEscape(s.key('Enter'))).toBe(false)
  s.overlay.open = false
  expect(isOverlayEscape(s.key())).toBe(false)
  s.dispose()
})
