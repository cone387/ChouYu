export const BOOKMARK_ACCELERATOR = 'CommandOrControl+Shift+B'

/** Tracks ownership so failure never unregisters someone else's shortcut. */
export class BookmarkShortcut {
  private registered = false
  constructor(private shortcuts: { register(key: string, handler: () => void): boolean; unregister(key: string): void }, private capture: () => void) {}
  enable(enabled: boolean): void {
    if (enabled === this.registered) return
    if (enabled) {
      if (!this.shortcuts.register(BOOKMARK_ACCELERATOR, this.capture)) throw new Error('书签快捷键已被占用，请释放 Ctrl/⌘+Shift+B 后重试。')
      this.registered = true
    } else {
      this.shortcuts.unregister(BOOKMARK_ACCELERATOR)
      this.registered = false
    }
  }
}
