import { useEffect, useRef, useState } from 'react'
import type { AgentDelivery } from '../../../../shared/agent-delivery'
import type { AgentTopic } from '../../../../shared/agents'

const stageLabel = { pending: '待开始', active: '进行中', done: '已完成' }
export default function ContactDelivery({ characterId, topic, busy, onAction, onReport, view = 'delivery' }: {
  characterId: string; topic: AgentTopic; busy: boolean
  onAction: (action: () => Promise<unknown>) => Promise<void>
  view?: 'stages' | 'delivery'
  onReport?: () => void
}) {
  const [artifact, setArtifact] = useState<AgentDelivery | null>(null)
  const [previous, setPrevious] = useState<AgentDelivery | null>(null)
  const [latest, setLatest] = useState(0), [loading, setLoading] = useState(true)
  const [error, setError] = useState(''), [feedback, setFeedback] = useState(''), [notice, setNotice] = useState('')
  const [sectionId, setSectionId] = useState('')
  const [readingId, setReadingId] = useState('')
  const epoch = useRef(0)
  const load = async (version?: number) => {
    const request = ++epoch.current
    setLoading(true); setError(''); setNotice('')
    try {
      const value = await window.electronAPI.agents.delivery(characterId, topic.id, version)
      const before = value && value.version > 1 ? await window.electronAPI.agents.delivery(characterId, topic.id, value.version - 1) : null
      if (request !== epoch.current) return
      setArtifact(value); setPrevious(before)
      setReadingId(id => value?.sections.some(section => section.id === id) ? id : value?.sections.find(section => section.runId === value.runId)?.id ?? value?.sections[0]?.id ?? '')
      setSectionId(id => value?.sections.some(section => section.id === id) ? id : '')
      if (version === undefined) setLatest(value?.version ?? 0)
    } catch (e) { if (request === epoch.current) setError(e instanceof Error ? e.message : '成果读取失败。') }
    finally { if (request === epoch.current) setLoading(false) }
  }
  useEffect(() => { setArtifact(null); setPrevious(null); void load(); return () => { epoch.current++ } }, [characterId, topic.id, topic.revision])
  return <section className="contact-delivery" aria-label="阶段计划与成果" data-delivery-version={artifact?.version}>
    <div hidden={view !== 'stages'}>
      <div className="topic-heading"><h4>阶段计划</h4>{artifact && <span className="agent-caption">版本 {artifact.version} / {latest}</span>}</div>
      {loading && <p role="status">正在读取阶段计划…</p>}
      {error && <p role="alert">{error}<button type="button" onClick={() => void load()}>重试</button></p>}
      {!loading && !error && !artifact && <p className="agent-empty">尚未生成阶段计划，任务推进后会在这里显示。</p>}
      {artifact && !loading && <>      <div><p><strong>完成条件：</strong>{artifact.completionCriteria}</p>
      <ol className="delivery-stages">{artifact.stages.map(stage => <li key={stage.id}><span>{stage.title}</span><span className="agent-caption">{stageLabel[stage.status]}</span></li>)}</ol>
      <p className="delivery-summary">{artifact.summary}</p>
      </div>
</>}
    </div>
    <div hidden={view !== 'delivery'}>
    <div className="topic-heading"><h4>任务成果</h4>{artifact && <span className="agent-caption">已保存 {artifact.sections.length} 节 · 版本 {artifact.version} / {latest}</span>}</div>
    {loading && <p role="status">正在读取成果…</p>}
    {error && <p role="alert">{error}<button type="button" onClick={() => void load()}>重试</button></p>}
    {!loading && !error && !artifact && <div className="delivery-empty"><p>尚未保存可阅读的成果正文。</p><p className="agent-caption">进展中提到“已完成”不代表已有正文。旧任务的内容可能保存在工作报告中。</p>{onReport && <button type="button" onClick={onReport}>查看最近工作报告</button>}</div>}
    {artifact && !loading && <>
      <nav className="delivery-directory" aria-label="成果目录">{artifact.sections.map(section => <button type="button" key={section.id} aria-pressed={readingId === section.id} onClick={() => setReadingId(section.id)}>{section.title}</button>)}</nav>
      {artifact.sections.filter(section => section.id === readingId).map(section => <article className="delivery-reader" key={section.id} aria-label={section.title}><h5>{section.title}</h5><div>{section.body}</div>{section.sources?.length ? <details><summary>本节资料来源</summary><ol>{section.sources.map((source, i) => <li key={`${source.url}:${i}`}><a href={source.url} target="_blank" rel="noopener noreferrer">[{i + 1}] {source.title}</a></li>)}</ol></details> : null}</article>)}
      <details><summary>版本与导出</summary>
      <div className="agent-actions">
        <button data-delivery-prev type="button" disabled={artifact.version <= 1} onClick={() => void load(artifact.version - 1)}>上一版</button>
        <button data-delivery-next type="button" disabled={artifact.version >= latest} onClick={() => void load(artifact.version + 1)}>下一版</button>
        <button type="button" disabled={busy} onClick={() => void onAction(async () => { if (await window.electronAPI.agents.exportDelivery(characterId, topic.id, artifact.version)) setNotice('此版本已导出。') })}>导出此版本</button>
      </div>
      {previous && <details><summary>与上一版比较</summary>{artifact.sections.filter(s => { const old = previous.sections.find(p => p.id === s.id); return !old || old.body !== s.body || old.title !== s.title }).map(s => {
        const old = previous.sections.find(p => p.id === s.id)
        return <article className="delivery-diff" key={s.id}><h5>{s.title} · {old ? '已修改' : '新增'}</h5>{old && <><strong>修改前</strong><div>{old.body}</div></>}<strong>修改后</strong><div>{s.body}</div></article>
      })}<p className="agent-caption">完成条件与阶段以当前查看版本为准；未列出的分节正文保持不变。</p></details>}
      </details>
    </>}
    <details><summary>提出修改意见</summary>
    <form onSubmit={event => { event.preventDefault(); void onAction(async () => { await window.electronAPI.agents.reviseTopic(characterId, topic.id, topic.revision, feedback, sectionId || undefined); setFeedback(''); setNotice('修改意见已提交，将按当前成果修订一轮。') }) }}>
      {artifact && <label>修订位置<select value={sectionId} onChange={e => setSectionId(e.target.value)}><option value="">由联系人根据意见安排</option>{artifact.sections.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>}
      <label>修改意见<textarea data-delivery-feedback value={feedback} onChange={e => setFeedback(e.target.value)} maxLength={2000} rows={2} required placeholder="例如：第二章改用主角视角，保留结尾" /></label>
      <p className="agent-caption">按最新成果立即修订一轮，保留旧版本并使用现有额度。多节修改会分轮推进。</p>
      <button data-delivery-submit type="submit" disabled={busy || !feedback.trim()}>提交并修订</button>
    </form>
    </details>
    {notice && <p role="status">{notice}</p>}
    </div>
  </section>
}
