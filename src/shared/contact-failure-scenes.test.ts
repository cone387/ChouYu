import { expect, it } from 'vitest'
import { contactFailure } from './contact-failure'

it.each([
  ['资料不在本轮目录快照内，请按本轮提供的版本读取。', 'material', '资料引用需要纠正'],
  ['资料已撤回，无法继续读取。', 'material', '参考资料已不可用'],
  ['未能可靠确认章节收尾与推进方式，本轮未写入正文；已有章节保留。', 'chapter', '章节衔接尚未确认'],
  ['本轮分段恢复次数已用完', 'output', '正文生成中断'],
  ['SQLITE_FULL: database or disk is full', 'storage', '成果未能保存'],
  ['参考记忆已被纠正或忘记，本轮不能继续提交。', 'context', '参考内容已变化']
  ,['无法可靠核对任务结束条件，本轮未提交，原任务和已有成果保留。', 'format', '任务结束条件尚未确认']
])('explains the specific blocker %s without guessing quota or permissions', (error, kind, title) => {
  expect(contactFailure(error)).toMatchObject({ kind, title })
  expect(contactFailure(error).message).not.toContain('查看任务中的工作记录了解原因')
})
it.each(['工具调用次数超过安全上限。', '网络超时', 'Docker 未启动', '下次检查间隔无效。'])('does not invent saved prose for %s', error => {
  expect(contactFailure(error).message).not.toMatch(/已有(?:成果|正文)保留/)
})
it('does not pretend an unclassified failure has a known cause or saved work', () => {
  const failure = contactFailure('unexpected vendor failure')
  expect(failure.message).toContain('尚未识别')
  expect(failure.message).not.toContain('已有成果保留')
})
