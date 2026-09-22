// 点击穿透状态的 renderer 侧唯一写入口：真实窗口状态由主进程控制器持有，
// 这里维护「认知」，所有变更必须经过 setMouseIgnored，主进程广播
// mouse-events-state 时回写认知，保证认知与真实状态不发散。
let ignored = true

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
