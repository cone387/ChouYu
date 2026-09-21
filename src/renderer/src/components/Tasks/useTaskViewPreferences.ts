import { useEffect, useState, type SetStateAction } from 'react'
import { recommendedTaskPreferences, parseTaskPreferences, TASK_PREFERENCES_KEY, type TaskViewPreferences } from './taskViewPreferences'

export default function useTaskViewPreferences(scope: string) {
  const [saved, setSaved] = useState(() => {
    try { return parseTaskPreferences(localStorage.getItem(TASK_PREFERENCES_KEY)) } catch { return {} }
  })
  const [storageError, setStorageError] = useState('')
  useEffect(() => {
    try { localStorage.setItem(TASK_PREFERENCES_KEY, JSON.stringify(saved)); setStorageError('') }
    catch { setStorageError('视图配置暂时无法保存，重启后可能恢复默认。') }
  }, [saved])
  const value = saved[scope] ?? recommendedTaskPreferences(scope)
  const update = (target: string, patch: Partial<TaskViewPreferences> | ((current: TaskViewPreferences) => TaskViewPreferences)) => {
    setSaved(current => {
      const previous = current[target] ?? recommendedTaskPreferences(target)
      return { ...current, [target]: typeof patch === 'function' ? patch(previous) : { ...previous, ...patch } }
    })
  }
  const set = <K extends keyof TaskViewPreferences>(key: K, next: SetStateAction<TaskViewPreferences[K]>) => {
    update(scope, previous => ({ ...previous, [key]: typeof next === 'function' ? (next as (value: TaskViewPreferences[K]) => TaskViewPreferences[K])(previous[key]) : next }))
  }
  return { value, set, update, storageError, forScope: (target: string) => saved[target] ?? recommendedTaskPreferences(target) }
}
