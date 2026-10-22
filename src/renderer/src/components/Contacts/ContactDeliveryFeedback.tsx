import { useEffect, useRef, useState } from 'react'
import type { DeliveryFeedbackRecord } from '../../../../shared/delivery-feedback'
import { navigateContact } from './contactNavigation'

const labels: Record<DeliveryFeedbackRecord['status'], string> = {
  accepted: '已认可此版，任务状态不变', unlinked: '历史反馈，未关联修订结果', 'no-result': '本轮已结束，尚无新版成果',
  queued: '修订已排队', running: '正在修订', waiting: '等你补充信息', interrupted: '修订中断，等待恢复',
  failed: '修订失败，意见已保留', cancelled: '修订已停止，意见已保留', completed: '已产生修订结果'
}
export default function ContactDeliveryFeedback({ owner, topicId, active = true, onOpen }: {
  owner: string; topicId: string; active?: boolean; onOpen?: (version: number) => void | Promise<void>
}) {
  const [data, setData] = useState<{ owner: string; topicId: string; rows: DeliveryFeedbackRecord[] }>(), [error, setError] = useState('')
  const rows = data?.owner === owner && data.topicId === topicId ? data.rows : []
  const epoch = useRef(0)
  const load = async () => {
    const current = ++epoch.current
    try {
      const result = await window.electronAPI.agents.deliveryFeedbackList(owner, topicId)
      if (current === epoch.current) { setData({ owner, topicId, rows: result }); setError('') }
    } catch (e) { if (current === epoch.current) setError(e instanceof Error ? e.message : '反馈读取失败。') }
  }
  useEffect(() => {
    if (!active) return
    void load()
    const off = window.electronAPI.agents.onChanged(id => { if (id === owner) void load() })
    return () => { epoch.current++; off() }
  }, [owner, topicId, active])
  const open = async (version: number) => {
    try { if (onOpen) await onOpen(version); else await navigateContact({ kind: 'delivery', ref: { characterId: owner, topicId, version } }) }
    catch (e) { setError(e instanceof Error ? e.message : '成果版本打开失败。') }
  }
  if (!rows.length && !error) return null
  return <section className="topic-interactions" data-delivery-feedback-records>
    <h4>成果反馈</h4>
    {error && <p className="agent-error" role="alert">{error}<button type="button" onClick={() => void load()}>重试</button></p>}
    <ol>{rows.map(row => <li key={row.id} className="topic-interaction-card" data-feedback-id={row.id} data-feedback-status={row.status}>
      <header><strong>对第 {row.baseVersion} 版的{row.action === 'accept' ? '认可' : '修改意见'}</strong><time>{new Date(row.createdAt).toLocaleString('zh-CN', { hour12: false })}</time></header>
      <p>{row.reason}</p><p className="agent-caption">{labels[row.status]}</p>
      <div className="agent-actions"><button type="button" data-feedback-base onClick={() => void open(row.baseVersion)}>查看基准版 {row.baseVersion}</button>
        {row.resultVersion && <button type="button" data-feedback-result onClick={() => void open(row.resultVersion!)}>查看结果版 {row.resultVersion}</button>}</div>
    </li>)}</ol>
  </section>
}
