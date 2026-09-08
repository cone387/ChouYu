import { useEffect, useState } from 'react'
import type { AIUsage } from '../../../../shared/ai-usage'
import type { JournalAnalysisRecord } from '../../../../shared/journal'

const count = (value?: number) => value === undefined ? '未返回' : value.toLocaleString('zh-CN')
export function JournalUsage({ usage }: { usage?: AIUsage }) {
  return <span className="journal-token-usage">输入 {count(usage?.inputTokens)} · 输出 {count(usage?.outputTokens)} · 总计 {count(usage?.totalTokens)} token
    {usage?.cacheReadTokens !== undefined && ` · 缓存读取 ${count(usage.cacheReadTokens)}`}
    {usage?.cacheWriteTokens !== undefined && ` · 缓存写入 ${count(usage.cacheWriteTokens)}`}
  </span>
}

const states = { running: '进行中', success: '已完成', failed: '失败', cancelled: '已取消' }
export function JournalUsageHistory({ date, revision }: { date: string; revision: number }) {
  const [records, setRecords] = useState<JournalAnalysisRecord[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => { setLoading(true); setRecords([]) }, [date])
  useEffect(() => {
    let active = true
    const from = new Date(`${date}T00:00:00`); const to = new Date(from); to.setDate(to.getDate() + 1)
    void window.electronAPI.journal.analysisRecords({ from: from.getTime(), to: to.getTime() }).then(value => {
      if (active) { setRecords(value); setError(''); setLoading(false) }
    }).catch(reason => { if (active) { setError(String(reason)); setLoading(false) } })
    return () => { active = false }
  }, [date, revision])
  const known = records.filter(record => record.state !== 'running' && record.usage?.totalTokens !== undefined)
  return <section className="journal-usage-history" aria-label="AI 调用记录">
    <h2>AI 调用记录</h2><p>针对 {date} 的日志总结与问答。重新生成会保留每次调用记录。</p>
    <p>{records.length} 次调用 · 已知用量 {known.reduce((sum, record) => sum + record.usage!.totalTokens!, 0).toLocaleString('zh-CN')} token{known.length < records.length ? ` · ${records.length - known.length} 次用量未完整返回` : ''}</p>
    <p className="journal-task-hint">用量由服务商返回；失败、取消的调用可能只有部分用量。旧记录无法补算。Claude 的缓存输入计入总量。</p>
    {error && <p role="alert" className="journal-error">{error}</p>}
    {loading ? <p role="status">正在读取调用记录…</p> : !records.length && !error ? <div className="journal-empty">这一天还没有 AI 调用记录</div> : <ol className="journal-usage-list journal-list-scroll" tabIndex={0} aria-label="模型与用量列表">{records.map(record => <li key={record.id}>
      <div><strong>{record.kind === 'summary' ? '日志总结' : '日志问答'}</strong><span>{states[record.state]}</span><time>{new Date(record.createdAt).toLocaleString('zh-CN')}</time></div>
      <p>{record.model} <span>· {record.provider}</span></p>
      {record.model !== record.requestedModel && <p>请求模型：{record.requestedModel}</p>}
      <JournalUsage usage={record.usage} />
    </li>)}</ol>}
  </section>
}
