import { describe, expect, it, vi } from 'vitest'
import { BOOKMARK_ACCELERATOR, BookmarkShortcut } from './bookmark-shortcut'

describe('bookmark shortcut ownership', () => {
  it('does not replace or unregister a conflicting shortcut, and can retry', () => {
    const api = { register: vi.fn(() => false), unregister: vi.fn() }
    const shortcut = new BookmarkShortcut(api, vi.fn())
    expect(() => shortcut.enable(true)).toThrow('占用')
    shortcut.enable(false)
    expect(api.unregister).not.toHaveBeenCalled()
    api.register.mockReturnValue(true)
    shortcut.enable(true); shortcut.enable(true); shortcut.enable(false)
    expect(api.register).toHaveBeenCalledTimes(2)
    expect(api.unregister).toHaveBeenCalledExactlyOnceWith(BOOKMARK_ACCELERATOR)
  })
  it('invokes capture without focusing a window or changing other shortcuts', () => {
    const capture = vi.fn()
    const api = { register: vi.fn((_key: string, handler: () => void) => { handler(); return true }), unregister: vi.fn() }
    new BookmarkShortcut(api, capture).enable(true)
    expect(capture).toHaveBeenCalledOnce()
  })
})
