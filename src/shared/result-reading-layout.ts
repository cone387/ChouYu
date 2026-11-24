/** A designer may compose saved sections, never supply replacement prose or executable UI. */
export type ResultReadingKind = 'document' | 'story' | 'report' | 'ideas' | 'steps'
export type ResultReadingLayout = {
  kind: ResultReadingKind
  sections: { id: string; treatment: 'body' | 'emphasis' }[]
}
export const resultReadingLabels: Record<ResultReadingKind, string> = {
  document: '正文阅读', story: '章节阅读', report: '报告阅读', ideas: '想法浏览', steps: '步骤阅读'
}

export function validateReadingLayout(value: unknown): ResultReadingLayout {
  const v = value as ResultReadingLayout
  if (!v || Object.keys(v).some(key => !['kind', 'sections'].includes(key))
    || !Object.hasOwn(resultReadingLabels, v.kind) || !Array.isArray(v.sections) || !v.sections.length || v.sections.length > 300
    || v.sections.some(s => !s || Object.keys(s).some(key => !['id', 'treatment'].includes(key))
      || typeof s.id !== 'string' || !/^[a-zA-Z0-9_:-]{1,160}$/.test(s.id) || !['body', 'emphasis'].includes(s.treatment))
    || new Set(v.sections.map(s => s.id)).size !== v.sections.length) throw new Error('成果布局无效，请保留全部分节且每节仅出现一次。')
  return { kind: v.kind, sections: v.sections.map(s => ({ id: s.id, treatment: s.treatment })) }
}
