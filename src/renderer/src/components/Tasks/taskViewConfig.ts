export interface TaskNavConfig { order: string[]; hidden: string[] }
export const TASK_VIEW_CONFIG_KEY = 'chouyu:task-view-config:v1'
export const SMART_NAV_ORDER = ['today', 'week', 'unplanned', 'all', 'overdue', 'done'] as const

const strings = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string'))] : []

export function defaultTaskNavConfig(): TaskNavConfig {
  return { order: [...SMART_NAV_ORDER], hidden: ['done'] }
}

export function parseTaskNavConfig(raw: string | null): TaskNavConfig {
  if (raw === null) return defaultTaskNavConfig()
  try {
    const data: unknown = JSON.parse(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return defaultTaskNavConfig()
    const item = data as { order?: unknown; hidden?: unknown }
    const order = strings(item.order)
    return { order, hidden: strings(item.hidden).filter(key => order.includes(key)) }
  } catch { return defaultTaskNavConfig() }
}

/** 智能视图键为固定全集；自定义视图随增删同步，新视图默认收进「更多」。 */
export function normalizeTaskNavConfig(config: TaskNavConfig, views: { id: string }[]): TaskNavConfig {
  const viewKeys = new Set(views.map(view => `view:${view.id}`))
  const known = new Set<string>(SMART_NAV_ORDER)
  const appended = [...viewKeys].filter(key => !config.order.includes(key))
  const order = [
    ...config.order.filter(key => known.has(key) || viewKeys.has(key)),
    ...[...known].filter(key => !config.order.includes(key)),
    ...appended
  ]
  return { order, hidden: [...new Set([...config.hidden.filter(key => order.includes(key)), ...appended])] }
}
