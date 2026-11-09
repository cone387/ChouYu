// 点击穿透状态的 renderer 侧唯一写入口：真实窗口状态由主进程控制器持有，
// 这里维护「认知」，所有变更必须经过 setMouseIgnored，主进程广播
// mouse-events-state 时回写认知，保证认知与真实状态不发散。
let ignored = true

/** Re-hit-test a stationary pointer when the geometry under it changes. */
export function observeHitTestChanges(update:()=>void):()=>void {
  let frame:number|undefined,stopped=false
  const schedule=()=>{if(stopped||frame!==undefined)return;frame=requestAnimationFrame(()=>{frame=undefined;update()})}
  const sizes=new ResizeObserver(schedule),targets=new Set<Element>()
  const refreshTargets=()=>{
    for(const target of targets)if(!target.isConnected){sizes.unobserve(target);targets.delete(target)}
    for(const target of [document.documentElement,...document.querySelectorAll('[data-interactive],[data-interactive-bounds]')])if(!targets.has(target)){targets.add(target);sizes.observe(target)}
  }
  const mutations=new MutationObserver(records=>{if(records.some(r=>r.type==='childList'||r.attributeName==='data-interactive'||r.attributeName==='data-interactive-bounds'))refreshTargets();schedule()})
  mutations.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['style','class','open','hidden','data-interactive','data-interactive-bounds','data-window-gesture']})
  const events=['scroll','transitionrun','transitionend','animationend','toggle']
  for(const event of events)document.addEventListener(event,schedule,true)
  window.addEventListener('resize',schedule)
  refreshTargets();schedule()
  return()=>{stopped=true;mutations.disconnect();sizes.disconnect();if(frame!==undefined)cancelAnimationFrame(frame);for(const event of events)document.removeEventListener(event,schedule,true);window.removeEventListener('resize',schedule)}
}

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
