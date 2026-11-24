import { designHash, sourceSnapshot, type ResultSourceSnapshot } from './result-design'
import { validateReadingLayout, type ResultReadingKind, type ResultReadingLayout } from './result-reading-layout'

export const RESULT_READING_CATALOG = 'https://chouyu.local/catalogs/result-reading/v1'

/** Host-owned projection: wire messages carry references, never generated prose or actions. */
export function validateResultLayout(value: unknown, source: ResultSourceSnapshot): ResultReadingLayout {
  const layout = validateReadingLayout(value)
  if (layout.sections.length !== source.sections.length || layout.sections.some(s => !source.sections.some(original => original.id === s.id)))
    throw new Error('成果布局与保存版本不一致。')
  return layout
}

export function defaultResultLayout(source: ResultSourceSnapshot): ResultReadingLayout {
  const headings = [source.title, ...source.sections.map(s => s.title)].join('\n')
  const opening = source.sections.map(s => s.body.slice(0, 300)).join('\n').slice(0, 4000)
  let kind: ResultReadingKind = 'document'
  if (/小说|故事|散文|第[一二三四五六七八九十百\d]+[章节]|chapter\s+\d/i.test(headings + '\n' + opening)) kind = 'story'
  else if (/评审|研究|报告|分析|调研|复盘|review|research/i.test(headings) || /(?:^|\n)[#*\s]*(?:结论|建议|依据)[：:]/.test(opening)) kind = 'report'
  else if (/想法|创意|点子|ideas?|brainstorm/i.test(headings)) kind = 'ideas'
  else if (/步骤|操作指南|实施计划|流程|教程|部署|how.to/i.test(headings)) kind = 'steps'
  return { kind, sections: source.sections.map(s => ({ id: s.id, treatment: kind === 'report' && /结论|建议|摘要|summary|verdict/i.test(s.title) ? 'emphasis' : 'body' })) }
}

export function createResultReadingSurface(input: ResultSourceSnapshot, requestedLayout?: unknown) {
  const saved = sourceSnapshot(input.ref, input.ref.sourceId, input.title, input.sections, input.fileIds)
  if (saved.ref.contentHash !== input.ref.contentHash) throw new Error('成果正文与保存版本不一致，请重新打开。')
  const layout = requestedLayout === undefined ? defaultResultLayout(saved) : validateResultLayout(requestedLayout, saved)
  const surfaceId = `result-${designHash({ ref: saved.ref, layout })}`
  const components = [
    { id: 'root', component: 'ReadingDocument', children: ['contents', 'sections'] },
    { id: 'contents', component: 'ReadingContents' },
    { id: 'sections', component: 'ReadingSections', children: layout.sections.map(s => `section_${saved.sections.findIndex(original => original.id === s.id)}`) },
    ...layout.sections.map(s => { const sectionIndex = saved.sections.findIndex(original => original.id === s.id)
      return { id: `section_${sectionIndex}`, component: 'SavedSection', sectionIndex, treatment: s.treatment }
    })
  ]
  return {
    ...saved, surfaceId, layout,
    messages: [
      { version: '1.0', createSurface: { surfaceId, catalogId: RESULT_READING_CATALOG } },
      { version: '1.0', updateComponents: { surfaceId, components } }
    ] as const
  }
}
