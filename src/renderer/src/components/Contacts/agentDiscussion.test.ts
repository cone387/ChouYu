import { describe, expect, it } from 'vitest'
import { quoteAgentDiscussion } from './agentDiscussion'

describe('work discussion reference', () => {
  it('keeps the exact source identity and separates quotation from user feedback', () => {
    const result = quoteAgentDiscussion({ title: '团队需求', topicId: 'topic-1', runId: 'run-2', text: '初步发现\n仍需验证' }, '先核对预算')
    expect(result).toContain('事项 ID：topic-1\n记录 ID：run-2')
    expect(result).toContain('> 初步发现\n> 仍需验证\n【我的消息】\n先核对预算')
  })
})
