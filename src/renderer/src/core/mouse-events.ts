// 点击穿透状态的 renderer 侧唯一写入口：真实窗口状态由主进程控制器持有，
// 这里维护「认知」，所有变更必须经过 setMouseIgnored，主进程广播
// mouse-events-state 时回写认知，保证认知与真实状态不发散。
let ignored = true

/** Native dialog backdrops hit the dialog itself, even outside its visible bounds. */
export function isInteractiveHit(element: Element | null, x: number, y: number): boolean {
  if (!element?.closest('[data-interactive]')) return false
  const bounded = element.closest('[data-interactive-bounds]')
  if (!bounded) return true
  const rect = bounded.getBoundingClientRect()
  return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom
}

export function getMouseIgnored(): boolean {
  return ignored
}

export function setMouseIgnored(next: boolean): void {
  if (next === ignored) return
  ignored = next
  window.electronAPI.setIgnoreMouseEvents(next)
}

export function syncMouseEvents(): () => void {
  return window.electronAPI.onMouseEventsState((actual) => {
    ignored = actual
  })
}
