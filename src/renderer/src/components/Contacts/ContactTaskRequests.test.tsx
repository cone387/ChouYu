import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TaskRequestRows } from './ContactTaskRequests'
import type { TaskRequestRecord } from '../../../../shared/contact-task-requests'

const record: TaskRequestRecord = { id: 1, requestId: 'req', topicId: 't', revision: 2, effect: 'requirements', savedAt: 100,
  source: { requestId: 'req', sessionId: 's', text: '<script>原始要求</script>', acceptedAt: 90 }, tool: 'edit_contact_task', status: 'saved', attempts: [] }
it('shows saved requirements as saved, escapes their text, and invents no execution or result', () => {
  const html = renderToStaticMarkup(<TaskRequestRows rows={[record]} onRun={() => {}} onResult={() => {}} />)
  expect(html).toContain('要求已保存'); expect(html).toContain('&lt;script&gt;原始要求&lt;/script&gt;')
  expect(html).not.toContain('<script>'); expect(html).not.toContain('查看本轮'); expect(html).not.toContain('查看成果版本')
})
it('distinguishes a finished round without output from a real artifact and exposes only recorded links', () => {
  const noResult = renderToStaticMarkup(<TaskRequestRows rows={[{ ...record, status: 'no-result', attempts: [{ runId: 'run', linkedAt: 101, suppliedAt: 102, status: 'completed' }] }]} onRun={() => {}} onResult={() => {}} />)
  expect(noResult).toContain('尚无关联成果'); expect(noResult).toContain('查看本轮'); expect(noResult).not.toContain('查看成果版本')
  const saved = renderToStaticMarkup(<TaskRequestRows rows={[{ ...record, status: 'result-saved', attempts: [{ runId: 'run', linkedAt: 101, suppliedAt: 102, resultVersion: 3, status: 'completed' }] }]} onRun={() => {}} onResult={() => {}} />)
  expect(saved).toContain('查看成果版本 3'); expect(saved).not.toContain('全部要求已完成')
})
