import { describe, expect, it } from 'vitest'
import { sourceSnapshot } from './result-design'
import { createResultReadingSurface, defaultResultLayout, validateResultLayout } from './result-a2ui'

const task = { domain: 'contact' as const, ownerId: 'author', taskId: 'task' }
const snapshot = (body = '**原文**\n\n第二段<script>不执行</script>') => sourceSnapshot(task, 'saved', '正式成果', [
  { id: 'first', title: '同名章节', body, sources: [{ title: '来源', url: 'https://example.com' }] },
  { id: 'last', title: '同名章节', body: '末尾正文', sources: [] }
], [])

describe('A2UI result reading projection', () => {
  it('chooses distinct layouts from saved content without inventing summaries', () => {
    const make = (title: string, body: string) => sourceSnapshot(task, '1', title, [{ id: 'a', title, body, sources: [] }], [])
    expect(defaultResultLayout(make('雨停之前', '第一章 雨夜\n\n她推开门。')).kind).toBe('story')
    expect(defaultResultLayout(make('接口评审', '结论：建议修改后采用。\n依据：缺少超时。')).kind).toBe('report')
    expect(defaultResultLayout(make('三个产品想法', '- 阅读书签\n- 资料对照')).kind).toBe('ideas')
    expect(defaultResultLayout(make('部署操作步骤', '1. 构建\n2. 检查\n3. 发布')).kind).toBe('steps')
    expect(defaultResultLayout(make('普通正文', '完整正文')).kind).toBe('document')
  })

  it('accepts a designer composition only when every saved section appears once', () => {
    const input = snapshot()
    const layout = { kind: 'report', sections: [{ id: 'last', treatment: 'emphasis' }, { id: 'first', treatment: 'body' }] }
    const result = createResultReadingSurface(input, layout)
    expect(result.layout.sections.map(s => s.id)).toEqual(['last', 'first'])
    expect(result.messages[1].updateComponents.components.filter(c => 'sectionIndex' in c).map(c => c.sectionIndex)).toEqual([1, 0])
    expect(result.sections[0].body).toBe(input.sections[0].body)
    for (const invalid of [
      { ...layout, sections: [layout.sections[0]] },
      { ...layout, sections: [layout.sections[0], layout.sections[0]] },
      { ...layout, sections: [{ id: 'foreign', treatment: 'body' }, layout.sections[0]] },
      { ...layout, script: 'doSomething()' },
      { ...layout, kind: 'unknown' },
      { ...layout, sections: [{ id: 'first', treatment: 'hidden' }, layout.sections[0]] }
    ]) expect(() => validateResultLayout(invalid, input)).toThrow()
  })
  it('references every saved section in order without putting prose into UI instructions', () => {
    const input = snapshot()
    const result = createResultReadingSurface(input)
    expect(result.sections.map(section => section.id)).toEqual(['first', 'last'])
    expect(result.sections[0].body).toBe('**原文**\n\n第二段<script>不执行</script>')
    expect(result.sections[0].sources).toEqual([{ title: '来源', url: 'https://example.com' }])
    expect(JSON.stringify(result.messages)).not.toContain('第二段')
    expect(result.messages[1].updateComponents.components.filter(c => 'sectionIndex' in c).map(c => c.sectionIndex)).toEqual([0, 1])
  })

  it('pins an independent snapshot and retains the end of long text', () => {
    const input = snapshot('正文'.repeat(10000) + '末尾不能截断')
    const result = createResultReadingSurface(input)
    input.sections[0].body = '后来修改'
    input.sections[0].sources[0].title = '后来来源'
    expect(result.sections[0].body).toBe('正文'.repeat(10000) + '末尾不能截断')
    expect(result.sections[0].sources[0].title).toBe('来源')
  })

  it('isolates same-named results by owner, task and content version', () => {
    const input = snapshot()
    const a = createResultReadingSurface(input)
    const b = createResultReadingSurface(sourceSnapshot({ ...task, ownerId: 'other' }, 'saved', input.title, input.sections, []))
    const c = createResultReadingSurface(snapshot('新版本正文'))
    expect(a.surfaceId).not.toBe(b.surfaceId)
    expect(a.surfaceId).not.toBe(c.surfaceId)
  })

  it('rejects an empty or mismatched source instead of displaying invented content', () => {
    const empty = snapshot(); empty.sections = []
    expect(() => createResultReadingSurface(empty)).toThrow()
    const changed = snapshot(); changed.sections[0].body = '无对应版本的正文'
    expect(() => createResultReadingSurface(changed)).toThrow()
  })
})
