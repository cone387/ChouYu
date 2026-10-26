import { useRef, useState } from 'react'
import type { ContactInteractionSubmission } from '../../../../shared/contact-interactions'

export default function ContactStorageReview({ busy, contactOnly = false, submit }: {
  busy: boolean; contactOnly?: boolean; submit(review: NonNullable<ContactInteractionSubmission['storageRecovery']>): Promise<void>
}) {
  const [evidence, setEvidence] = useState(''), [scopes, setScopes] = useState(false), [verified, setVerified] = useState(false)
  const [limits, setLimits] = useState({ dailyCalls: '', dailyTokens: '', taskCalls: '', taskTokens: '' })
  const request = useRef<{ signature: string; id: string }>()
  return <form className="contact-storage-review" onSubmit={event => {
    event.preventDefault()
    const value = { evidence, scopesReviewed: scopes, externalEffects: verified ? 'verified' as const : 'unresolved' as const,
      ...(!contactOnly ? { daily: { calls: Number(limits.dailyCalls), tokens: Number(limits.dailyTokens) }, task: { calls: Number(limits.taskCalls), tokens: Number(limits.taskTokens) } } : {}) }
    const signature = JSON.stringify(value)
    if (request.current?.signature !== signature) request.current = { signature, id: crypto.randomUUID() }
    void submit({ ...value, requestId: request.current.id })
  }}>
    <p>{contactOnly ? '历史累计用量不完整。本次仅核对联系人资料；新任务仍需单独核对外部操作与新增额度。' : '历史累计用量不完整。下方额度是从本次恢复起新增的授权，未使用也不会补成历史零消耗。未知请求保留预留额度。'}</p>
    <label className="contact-interaction-field"><span>实际核对结果</span>
      <textarea required minLength={10} maxLength={4000} rows={4} value={evidence} disabled={busy} onChange={e => setEvidence(e.target.value)}
        placeholder="记录已核对的资料、记忆、共享权限，以及外部操作是否实际完成；仍不确定的内容请明确写出。" /></label>
    <label><input type="checkbox" checked={scopes} disabled={busy} onChange={e => setScopes(e.target.checked)} />已逐项核对此联系人的恢复资料、记忆与共享权限，可以再次用于模型上下文</label>
    {!contactOnly && <label><input type="checkbox" checked={verified} disabled={busy} onChange={e => setVerified(e.target.checked)} />本任务的外部操作结果已核实，没有仍未知的操作</label>}
    {!contactOnly && ([['dailyCalls', '今日额外调用次数'], ['dailyTokens', '今日额外 Token'], ['taskCalls', '本任务额外调用次数'], ['taskTokens', '本任务额外 Token']] as const).map(([key, label]) =>
      <label key={key} className="contact-interaction-field"><span>{label}</span><input aria-label={label} type="number" min={0} step={1}
        max={key.endsWith('Calls') ? 10000 : 1000000000} value={limits[key]} disabled={busy} onChange={e => setLimits(previous => ({ ...previous, [key]: e.target.value }))} placeholder="留空表示不追加" /></label>)}
    <button type="submit" className="primary" disabled={busy || evidence.trim().length < 10}>{busy ? '正在保存…' : contactOnly && scopes ? '保存联系人资料核对' : scopes && verified ? '保存核对并开始新尝试' : '保存核对，保持阻塞'}</button>
  </form>
}
