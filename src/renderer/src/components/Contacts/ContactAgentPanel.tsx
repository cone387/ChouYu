import { useEffect, useRef, useState } from 'react'
import { AGENT_STATUS, DEFAULT_AGENT_SETTINGS, TOPIC_STATUS, type AgentOverview, type AgentRunDetail, type AgentSettings } from '../../../../shared/agents'
import './ContactAgentPanel.css'
import ContactTopics from './ContactTopics'

const time = (value: number) => new Date(value).toLocaleString()
export type ContactAgentTab = 'work' | 'history' | 'memory'
export function ContactAgentPanel({ characterId, name, selectedTab, onTabChange, compact = false }: {
  characterId: string; name: string; selectedTab?: ContactAgentTab
  onTabChange?: (tab: ContactAgentTab) => void; compact?: boolean
}) {
  const [data, setData] = useState<AgentOverview | null>(null)
  const [draft, setDraft] = useState<AgentSettings>({ ...DEFAULT_AGENT_SETTINGS })
  const [sources, setSources] = useState('')
  const [localTab, setLocalTab] = useState<ContactAgentTab>('work')
  const tab = selectedTab ?? localTab
  const setTab = (next: ContactAgentTab) => { setLocalTab(next); onTabChange?.(next) }
  const [detail, setDetail] = useState<AgentRunDetail | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [readError, setReadError] = useState('')
  const [note, setNote] = useState(''), [answer, setAnswer] = useState('')
  const epoch = useRef(0), mounted = useRef(true), initialized = useRef(false)
  const refresh = async () => {
    const request = ++epoch.current
    try {
      const next = await window.electronAPI.agents.get(characterId)
      if (!mounted.current || request !== epoch.current) return
      setData(next)
      setReadError('')
      if (!initialized.current) { initialized.current = true; setDraft(next.settings); setSources(next.settings.sources.join('\n')) }
    } catch (error) { if (mounted.current && request === epoch.current) setReadError(String(error instanceof Error ? error.message : error)) }
  }
  useEffect(() => {
    mounted.current = true; void refresh()
    const dispose = window.electronAPI.agents.onChanged(id => { if (id === characterId) void refresh() })
    return () => { mounted.current = false; epoch.current++; dispose() }
  }, [characterId])
  const perform = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try { await action(); await refresh() } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : '操作失败，请重试。') }
    finally { if (mounted.current) setBusy(false) }
  }
  const settings = { ...draft, sources: sources.split('\n').map(s => s.trim()).filter(Boolean) }
  const dirty = data && JSON.stringify(settings) !== JSON.stringify(data.settings)
  const active = data?.runs.find(r => ['running', 'waiting', 'queued', 'interrupted'].includes(r.status))
  const focusedTopic = data?.topics.find(topic => topic.id === data.focusTopicId)
  const stoppedTopic = focusedTopic && ['paused', 'completed', 'abandoned'].includes(focusedTopic.status)
  const lastRun = data?.runs[0]
  return <section className={`contact-agent${compact ? ' contact-agent-compact' : ''}`} aria-label={`${name}的持续工作`} data-contact-agent={characterId}>
    {(!compact || tab === 'work') && <>
      <div className="agent-heading"><h3>自己的工作</h3><span role="status">{active ? AGENT_STATUS[active.status] : stoppedTopic ? `当前事项${TOPIC_STATUS[focusedTopic.status]}` : lastRun?.status === 'failed' ? '最近一轮失败' : data?.settings.enabled ? '按计划工作' : data?.settings.goal ? '仅手动运行' : '尚未设置工作方向'}</span></div>
      <p className="agent-description">开启持续工作后，关闭聊天仍会继续。应用需保持运行；退出或关机期间暂停，重启后恢复。</p>
    </>}
    {!compact && <div className="agent-tabs" aria-label="工作内容">
      {([['work', '任务'], ['history', '工作记录'], ['memory', '独立记忆']] as const).map(([id, label]) => <button type="button" key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}{id === 'memory' && data ? ` · ${data.memories.length}` : ''}</button>)}
    </div>}
    {(error || readError) && <div className="agent-error" role="alert">{error || readError}<button type="button" disabled={busy} onClick={() => { setError(''); setReadError(''); void refresh() }}>重新读取</button></div>}
    {!data && !error && !readError && <p role="status">正在读取工作状态…</p>}
    {data && <div hidden={tab !== 'work'}>
      {lastRun?.status === 'failed' && <p className="agent-error" role="alert">{lastRun.error}</p>}
      {active?.status === 'waiting' && <form className="agent-question" onSubmit={event => { event.preventDefault(); void perform(async () => { await window.electronAPI.agents.answer(characterId, active.id, answer); setAnswer('') }) }}>
        <strong>这一步需要你的想法</strong><p>{active.question}</p>
        <label>回复<textarea value={answer} maxLength={2000} onChange={e => setAnswer(e.target.value)} rows={3} required /></label>
        <button type="submit" disabled={busy || !answer.trim()}>回复并继续</button>
      </form>}
      <ContactTopics characterId={characterId} data={data} busy={busy} settingsDirty={Boolean(dirty)} onAction={perform}
        onReport={runId => { setTab('history'); setDetail(null); void perform(async () => setDetail(await window.electronAPI.agents.detail(characterId, runId))) }} />
      <details className="agent-work-settings" open={!data.settings.goal}>
      <summary>工作设置与资料来源</summary>
      <form onSubmit={e => { e.preventDefault(); void perform(async () => { const result = await window.electronAPI.agents.save(characterId, settings); setDraft(result.settings); setSources(result.settings.sources.join('\n')) }) }}>
        <label>长期工作方向<textarea data-agent-goal rows={3} maxLength={2000} required value={draft.goal} onChange={e => setDraft({ ...draft, goal: e.target.value })} placeholder="例如：持续研究独立开发者的收入机会，找真实需求，跟踪上轮假设是否成立。" /></label>
        <p className="agent-caption">长期方向用于约束所有事项。修改具体事项的目标，请使用上方「编辑事项」。</p>
        <label>允许读取的资料<span className="agent-caption">每行一个公开 HTTPS 网页，最多 5 个；只读，不执行网页指令。</span><textarea data-agent-sources rows={3} required value={sources} onChange={e => setSources(e.target.value)} placeholder="https://…" /></label>
        <div className="agent-settings-row"><label>间隔（分钟）<input type="number" min={15} max={10080} step={1} required value={draft.intervalMinutes} onChange={e => setDraft({ ...draft, intervalMinutes: Number(e.target.value) })} /></label><label>每日模型调用上限<input type="number" min={2} max={48} step={1} required value={draft.dailyCalls} onChange={e => setDraft({ ...draft, dailyCalls: Number(e.target.value) })} /></label></div>
        <label className="agent-toggle"><input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} />开启持续工作（会消耗模型额度）</label>
        <div className="agent-actions"><button data-agent-save type="submit" className="primary" disabled={busy}>保存工作设置</button><button data-agent-run type="button" disabled={busy || Boolean(dirty) || !data.settings.goal || Boolean(active) || !data.topics.some(t => t.id === data.focusTopicId && ['planned', 'researching', 'needs_evidence'].includes(t.status))} onClick={() => void perform(() => window.electronAPI.agents.run(characterId))}>推进当前事项一轮</button>{(data.settings.enabled || active) && <button type="button" disabled={busy} onClick={() => void perform(async () => { await window.electronAPI.agents.pause(characterId); setDraft(previous => ({ ...previous, enabled: false })) })}>暂停工作</button>}</div>
        {dirty && <p className="agent-caption">设置尚未保存。保存会停止当前未完成的工作。</p>}
      </form>
      </details>
      <p className="agent-caption">今日已调用 {data.callsToday}/{data.settings.dailyCalls} 次{data.settings.enabled && !active ? stoppedTopic ? ' · 当前事项已停止，等待你继续或选择其他事项' : ` · 下轮 ${data.callsToday >= data.settings.dailyCalls ? '明日额度恢复后' : data.nextAt > Date.now() ? time(data.nextAt) : '等待调度'}` : ''}。连续失败 3 轮会自动暂停。</p>
    </div>}
    {data && tab === 'history' && <>
      <p className="agent-caption">最近 30 轮。回看读到的资料、新的判断，以及接下来要验证什么。</p>
      {!data.runs.length && <p className="agent-empty">还没有工作经历。第一轮完成后，便能回看想法从哪里来。</p>}
      <ol className="agent-history">{data.runs.map(run => <li key={run.id}><button type="button" disabled={busy} onClick={() => void perform(async () => setDetail(await window.electronAPI.agents.detail(characterId, run.id)))}><span>{run.summary || AGENT_STATUS[run.status]}</span><small>{time(run.createdAt)} · {AGENT_STATUS[run.status]} · {data.topics.find(topic => topic.id === run.topicId)?.title || '升级前工作记录'}</small></button></li>)}</ol>
      {detail && <article className="agent-record"><h4>{detail.report?.title || AGENT_STATUS[detail.run.status]}</h4>{detail.run.error && <p role="alert">{detail.run.error}</p>}
        {detail.report && <><div className="agent-report">{detail.report.body}</div><p><strong>下一步：</strong>{detail.report.nextStep || '尚未安排'}</p><h4>当时读到的资料</h4>{detail.report.evidence.map((source, i) => <details key={source.url}><summary>[{i + 1}] {source.title}</summary><a href={source.url} target="_blank" rel="noopener noreferrer">打开原网页</a><p className="agent-caption">读取于 {time(source.capturedAt)} · 保存正文节选，非完整网页<br />SHA-256：{source.hash}</p><div className="agent-source-text">{source.text}</div></details>)}</>}
        <details><summary>查看工作经过 · {detail.events.length} 条记录</summary><ol>{detail.events.map(event => <li key={event.id}><time>{time(event.at)}</time><p>{event.text}</p></li>)}</ol></details>
      </article>}
    </>}
    {data && tab === 'memory' && <>
      <p className="agent-description">只属于{name}。研究结论会保留来源，可能需要修正；其他联系人不会读取这里的记忆。旧的全局记忆仍由默认丑鱼使用。</p>
      <form onSubmit={e => { e.preventDefault(); void perform(async () => { await window.electronAPI.agents.remember(characterId, note); setNote('') }) }}><label>告诉我一件需要记住的事<textarea rows={2} maxLength={2000} value={note} onChange={e => setNote(e.target.value)} required /></label><button type="submit" disabled={busy || !note.trim()}>存入独立记忆</button></form>
      {!data.memories.length && <p className="agent-empty">独立记忆还是空的，会随着真实工作逐渐积累。</p>}
      <ul className="agent-memories">{data.memories.map(memory => <li key={memory.id}><p>{memory.content}</p><div className="agent-memory-footer"><span className="agent-caption">{time(memory.createdAt)} · {memory.runId ? '研究结论' : '你告诉我的'}</span>{memory.runId && <button type="button" disabled={busy} onClick={() => void perform(async () => { setDetail(await window.electronAPI.agents.detail(characterId, memory.runId!)); setTab('history') })}>来源</button>}<button type="button" disabled={busy} aria-label={`忘记：${memory.content.slice(0, 20)}`} onClick={() => void perform(() => window.electronAPI.agents.forget(characterId, memory.id))}>忘记</button></div></li>)}</ul>
      <p className="agent-caption">最多 100 条。忘记会停止当前工作；历史成果仍保留。</p>
    </>}
  </section>
}
