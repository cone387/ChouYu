import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SESSION_TITLE,
  buildSessionPreview,
  deriveSessionTitle,
  filterSessionSummaries,
  formatSessionMarkdown,
  normalizeSessionTitle
} from './sessions'

describe('conversation sessions', () => {
  it('derives a compact title from the first user message', () => {
    expect(deriveSessionTitle([
      { role: 'assistant', content: '欢迎' },
      { role: 'user', content: '  帮我总结这份季度报告\n补充信息  ' }
    ])).toBe('帮我总结这份季度报告')
    expect(deriveSessionTitle([])).toBe(DEFAULT_SESSION_TITLE)
  })

  it('normalizes titles and builds the latest message preview', () => {
    expect(normalizeSessionTitle('  项目   计划  ')).toBe('项目 计划')
    expect(buildSessionPreview([
      { role: 'user', content: '第一条' },
      { role: 'assistant', content: '这是 最新\n回复' }
    ])).toBe('这是 最新 回复')
  })

  it('searches both session titles and previews', () => {
    const sessions = [
      { title: '项目计划', preview: '确定里程碑' },
      { title: '翻译', preview: 'Quarterly report' }
    ]
    expect(filterSessionSummaries(sessions, '里程碑')).toEqual([sessions[0]])
    expect(filterSessionSummaries(sessions, 'REPORT')).toEqual([sessions[1]])
  })

  it('exports a readable Markdown transcript', () => {
    const markdown = formatSessionMarkdown({
      title: '测试会话',
      createdAt: 0,
      messages: [
        { role: 'user', content: '你好', timestamp: 1 },
        { role: 'assistant', content: '你好呀', timestamp: 2 }
      ]
    }, 3)
    expect(markdown).toContain('# 测试会话')
    expect(markdown).toContain('## 用户')
    expect(markdown).toContain('## ChouYu')
    expect(markdown).toContain('你好呀')
  })
})
