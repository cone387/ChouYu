import { containsSecret } from './memory'

export const outputKinds = ['writing', 'ideas', 'review', 'research', 'plan', 'briefing', 'plain'] as const
export type ContactOutputKind = typeof outputKinds[number]
export interface ContactOutputDescriptor { kind: ContactOutputKind; density: 'comfortable' | 'compact' }
export interface ContactOutputPreference { kind?: ContactOutputKind | 'auto'; density?: 'comfortable' | 'compact'; instruction?: string }
export type ContactOutputScope = { kind: 'contact' } | { kind: 'task'; topicId: string } | { kind: 'delivery'; topicId: string; version: number }
export interface ContactOutputPreferenceRecord { scope: ContactOutputScope; revision: number; preference: ContactOutputPreference }

/** Generated presentation is optional: malformed metadata never discards valid prose. */
export function sanitizeContactOutput(raw: unknown): ContactOutputDescriptor | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
  const v = raw as ContactOutputDescriptor
  if (Object.keys(v).some(key => !['kind', 'density'].includes(key)) || !outputKinds.includes(v.kind) || v.density !== undefined && !['comfortable', 'compact'].includes(v.density)) return
  return { kind: v.kind, density: v.density ?? 'comfortable' }
}
export function validateOutputPreference(raw: unknown): ContactOutputPreference {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('阅读偏好无效。')
  const v = raw as ContactOutputPreference
  if (Object.keys(v).some(key => !['kind', 'density', 'instruction'].includes(key)) || v.kind !== undefined && v.kind !== 'auto' && !outputKinds.includes(v.kind) || v.density !== undefined && !['comfortable', 'compact'].includes(v.density)
    || v.instruction !== undefined && (typeof v.instruction !== 'string' || v.instruction.length > 2000 || containsSecret(v.instruction))) throw new Error('阅读偏好字段无效、过长或包含凭据。')
  return { ...(v.kind === undefined ? {} : { kind: v.kind }), ...(v.density === undefined ? {} : { density: v.density }), ...(v.instruction === undefined ? {} : { instruction: v.instruction.trim() }) }
}
/** Expression rules join the original generation request, never a second rewrite. */
export function contactExpressionInstruction(preferences: ContactOutputPreference[] = []): string {
  if (!preferences.length) return ''
  return `\n用户已保存的输出偏好（后项覆盖前项同字段）：${JSON.stringify(preferences.map(validateOutputPreference))}。这些要求只调整表达，不改变事实、任务要求、权限、状态或完成条件；保留必须报告的依据和待处理事项。\n`
}
export function resolveContactOutput(raw: unknown, preferences: unknown[] = []): ContactOutputDescriptor {
  const base = sanitizeContactOutput(raw) ?? { kind: 'plain' as const, density: 'comfortable' as const }
  let result = { ...base }
  for (const rawPreference of preferences) {
    try {
      const preference = validateOutputPreference(rawPreference)
      result = { kind: preference.kind === 'auto' ? base.kind : preference.kind ?? result.kind, density: preference.density ?? result.density }
    } catch { /* Invalid old preferences cannot make saved prose unreadable. */ }
  }
  return result
}
export const contactOutputInstruction = `\n为实际成果选择适合阅读的delivery.section.output：{"kind":"writing|ideas|review|research|plan|briefing|plain","density":"comfortable|compact"}。同一联系人可按本轮任务改变类型。写作直接给正文并保持段落；idea讲清想法/用途/假设；评审先结论再依据和建议；调研保留真实证据与来源，可用Markdown表格；计划写可行动的步骤；晨报简明说明事实和需要回应的事项。用户输出偏好优先，仅作表达与排版约定，不改变任务目标、权限或完成条件。output仅是安全展示描述，不放代码、正文、统计或动作。实际全部正文始终在section.body，不为卡片外观缩写或遗漏。`
