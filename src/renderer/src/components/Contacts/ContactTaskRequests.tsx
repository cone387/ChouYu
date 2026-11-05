import { useEffect, useRef, useState } from 'react'
import type { TaskRequestPage, TaskRequestRecord } from '../../../../shared/contact-task-requests'
import { navigateContact } from './contactNavigation'

const labels: Record<string, string> = { saved: '要求已保存，尚无后续执行记录', queued: '已关联排队轮次', running: '正在执行', waiting: '等待补充信息', interrupted: '执行中断，等待恢复', failed: '本轮失败，要求记录保留', cancelled: '本轮已停止，要求记录保留', 'no-result': '本轮已结束，尚无关联成果', 'result-saved': '本轮已保存关联成果', deleted: '任务已删除' }

export function TaskRequestRows({ rows, onRun, onResult, onSource }: {
  rows: TaskRequestRecord[]; onRun(runId: string): void; onResult(version: number): void; onSource?(sessionId: string, messageId: string): void
}) {
  return <ol>{rows.map(row => <li key={row.id} className="topic-interaction-card">
    <header><strong>你的要求</strong><time dateTime={new Date(row.savedAt).toISOString()}>{new Date(row.savedAt).toLocaleString('zh-CN', { hour12: false })}</time></header>
    <p>{row.source.text}</p>
    <p className="agent-caption">{row.effect === 'control' && row.status === 'saved' ? '操作已保存' : labels[row.status] ?? '状态暂不可用'}</p>
    {row.attempts[0]?.suppliedAt && <p className="agent-caption">已携带这些要求取得模型响应；是否落实请核对实际成果。</p>}
    <div className="agent-actions">
      {row.source.messageId && onSource && <button type="button" onClick={() => onSource(row.source.sessionId, row.source.messageId!)}>查看原始消息</button>}
      {row.attempts[0] && <button type="button" onClick={() => onRun(row.attempts[0].runId)}>查看本轮记录</button>}
      {row.attempts.find(attempt => attempt.resultVersion !== undefined)?.resultVersion !== undefined && <button type="button" onClick={() => onResult(row.attempts.find(attempt => attempt.resultVersion !== undefined)!.resultVersion!)}>查看成果版本 {row.attempts.find(attempt => attempt.resultVersion !== undefined)!.resultVersion}</button>}
    </div>
    {row.attempts.length > 1 && <details><summary>此前执行记录</summary><ul>{row.attempts.slice(1).map(attempt => <li key={attempt.runId}><button type="button" onClick={() => onRun(attempt.runId)}>{new Date(attempt.linkedAt).toLocaleString('zh-CN', { hour12: false })} · {labels[attempt.status] ?? '查看记录'}</button></li>)}</ul></details>}
  </li>)}</ol>
}

export default function ContactTaskRequests({ owner, topicId, active, onRun }: { owner: string; topicId: string; active: boolean; onRun(runId: string): void }) {
  const [data, setData] = useState<{ owner: string; topicId: string; page: TaskRequestPage }>()
  const [error, setError] = useState(''), [loading, setLoading] = useState(false)
  const [updated, setUpdated] = useState(false)
  const extended = useRef(false)
  const epoch = useRef(0)
  const page = data?.owner === owner && data.topicId === topicId ? data.page : { items: [] }
  const load = async (cursor?: number) => {
    const generation = ++epoch.current
    setLoading(true); setError('')
    try {
      const next = await window.electronAPI.agents.taskRequests(owner, topicId, cursor)
      if (generation !== epoch.current) return
      extended.current = cursor !== undefined
      if (cursor === undefined) setUpdated(false)
      setData(previous => ({ owner, topicId, page: { ...next, items: cursor && previous?.owner === owner && previous.topicId === topicId
        ? [...previous.page.items, ...next.items].filter((row, index, items) => items.findIndex(item => item.id === row.id) === index) : next.items } }))
    } catch (e) { if (generation === epoch.current) setError(e instanceof Error ? e.message : '请求记录读取失败。') }
    finally { if (generation === epoch.current) setLoading(false) }
  }
  useEffect(() => {
    if (!active) return
    extended.current = false
    void load()
    const off = window.electronAPI.agents.onChanged(id => { if (id === owner) { if (extended.current) setUpdated(true); else void load() } })
    return () => { epoch.current++; off() }
  }, [owner, topicId, active])
  const navigate = (target: Parameters<typeof navigateContact>[0]) => { void navigateContact(target).catch(e => setError(e instanceof Error ? e.message : '来源暂时无法打开。')) }
  return <section className="topic-interactions" aria-label="任务请求记录">
    <h4>任务请求记录</h4><p className="agent-caption">原始要求与实际执行分别记录。历史消息未留存关联时，不补造来源。</p>
    {updated && <p className="agent-caption">记录有更新，当前阅读位置保留。<button type="button" disabled={loading} onClick={() => void load()}>刷新记录</button></p>}
    {error && <p className="agent-error" role="alert">{error}<button type="button" onClick={() => void load()}>重试</button></p>}
    {loading && <p role="status">正在读取请求记录…</p>}
    {!loading && !error && !page.items.length && <p className="agent-caption">尚无可追溯的任务请求记录；已有需求原文仍可在任务需求记录中查看。</p>}
    <TaskRequestRows rows={page.items} onRun={onRun} onResult={version => navigate({ kind: 'delivery', ref: { characterId: owner, topicId, version } })} onSource={(sessionId, messageId) => navigate({ kind: 'message', sessionId, messageId })} />
    {page.nextCursor && <button type="button" disabled={loading} onClick={() => void load(page.nextCursor)}>更早的请求</button>}
  </section>
}
