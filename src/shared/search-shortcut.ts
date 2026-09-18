export const DEFAULT_SEARCH_SHORTCUT = 'CommandOrControl+K'

/** Application-local shortcuts; require a modifier to preserve normal typing. */
export function normalizeSearchShortcut(value: unknown): string {
  if (typeof value !== 'string') throw new Error('搜索快捷键无效。')
  if (!value.trim()) return ''
  const parts = value.trim().split('+').map(part => part.trim())
  const key = parts.pop()!.toUpperCase()
  const aliases: Record<string, string> = { ctrl: 'Control', control: 'Control', cmd: 'Meta', command: 'Meta', meta: 'Meta', alt: 'Alt', shift: 'Shift', commandorcontrol: 'CommandOrControl' }
  const modifiers = parts.map(part => aliases[part.toLowerCase()])
  if (!/^[A-Z0-9]$/.test(key) || modifiers.some(part => !part) || new Set(modifiers).size !== modifiers.length || !modifiers.some(part => part !== 'Shift') || (modifiers.includes('CommandOrControl') && (modifiers.includes('Control') || modifiers.includes('Meta')))) {
    throw new Error('请使用 Ctrl、CommandOrControl 或 Alt，加字母或数字，可同时加 Shift。')
  }
  const ordered = ['CommandOrControl', 'Control', 'Meta', 'Alt', 'Shift'].filter(part => modifiers.includes(part))
  if (['C', 'V', 'X', 'A', 'Z', 'Y', 'F', 'W', 'Q'].includes(key) && ordered.length === 1 && ordered[0] !== 'Alt' || ['Alt+F', 'Control+Shift+A', 'CommandOrControl+Shift+A', 'Control+Shift+B', 'CommandOrControl+Shift+B'].includes([...ordered, key].join('+'))) {
    throw new Error('该组合与常用操作冲突，请选择其他搜索快捷键。')
  }
  return [...ordered, key].join('+')
}

export function matchesSearchShortcut(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; isComposing: boolean; repeat: boolean }, shortcut: string, mac: boolean): boolean {
  if (!shortcut || event.isComposing || event.repeat) return false
  const parts = shortcut.split('+')
  const key = parts.pop()!
  return event.key.toUpperCase() === key && event.ctrlKey === (parts.includes('Control') || (!mac && parts.includes('CommandOrControl'))) && event.metaKey === (parts.includes('Meta') || (mac && parts.includes('CommandOrControl'))) && event.altKey === parts.includes('Alt') && event.shiftKey === parts.includes('Shift')
}

export function searchShortcutLabel(shortcut: string, mac: boolean): string {
  return shortcut.replace('CommandOrControl', mac ? '⌘' : 'Ctrl').replace('Control', 'Ctrl').replace('Meta', mac ? '⌘' : 'Win')
}
