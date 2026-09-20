import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { applyTaskOrder, moveTaskInOrder } from './taskViewPreferences'

const MIME = 'application/x-chouyu-layout-order'
const STORAGE_KEY = 'chouyu:task-board-columns'

export default function useTaskLayoutOrder() {
  const [orders, setOrders] = useState<Record<string, string[]>>(() => {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
      if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
      return Object.fromEntries(Object.entries(data).flatMap(([key, value]) => Array.isArray(value) && value.every(id => typeof id === 'string') ? [[key, value as string[]]] : []))
    } catch { return {} }
  })
  const [storageError, setStorageError] = useState('')
  const source = useRef<{ scope: string; id: string } | null>(null)
  const [target, setTarget] = useState<{ scope: string; id: string; after: boolean } | null>(null)
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(orders)); setStorageError('') }
    catch { setStorageError('排序暂时无法保存，重启后可能恢复默认。') }
  }, [orders])
  const save = (scope: string, ids: string[]) => setOrders(current => ({ ...current, [scope]: ids }))
  const sort = <T,>(scope: string, items: T[], key: (item: T) => string): T[] =>
    applyTaskOrder(items.map(item => ({ id: key(item), item })), orders[scope] ?? []).map(entry => entry.item)
  const finish = () => { source.current = null; setTarget(null) }
  const move = (scope: string, ids: string[], id: string, to: string, after: boolean) => {
    if (!ids.includes(id) || !ids.includes(to)) return
    setOrders(current => ({ ...current, [scope]: moveTaskInOrder(current[scope] ?? [], ids, id, to, after) }))
  }
  const handle = (scope: string, id: string, ids: string[]) => ({
    draggable: true,
    title: '拖动调整顺序；Alt + 上下方向键也可移动',
    onDragStart: (event: DragEvent<HTMLElement>) => {
      event.stopPropagation(); source.current = { scope, id }
      event.dataTransfer.setData(MIME, JSON.stringify({ scope, id }))
      event.dataTransfer.effectAllowed = 'move'
    },
    onDragEnd: finish,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
      event.preventDefault(); event.stopPropagation()
      const after = event.key === 'ArrowDown'
      const to = ids[ids.indexOf(id) + (after ? 1 : -1)]
      if (to !== undefined) move(scope, ids, id, to, after)
    }
  })
  const drop = (scope: string, id: string, ids: string[]) => ({
    'data-order-insert': target?.scope === scope && target.id === id ? (target.after ? 'after' : 'before') : undefined,
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (source.current?.scope !== scope || source.current.id === id || !event.dataTransfer.types.includes(MIME)) return
      event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'
      const rect = event.currentTarget.getBoundingClientRect()
      const after = event.clientY > rect.top + rect.height / 2
      setTarget(current => current?.scope === scope && current.id === id && current.after === after ? current : { scope, id, after })
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTarget(null)
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (source.current?.scope !== scope || !event.dataTransfer.types.includes(MIME)) return
      event.preventDefault(); event.stopPropagation()
      const rect = event.currentTarget.getBoundingClientRect()
      move(scope, ids, source.current.id, id, event.clientY > rect.top + rect.height / 2)
      finish()
    }
  })
  return { orders, save, sort, handle, drop, storageError }
}
