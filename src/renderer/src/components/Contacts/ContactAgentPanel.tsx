import { useEffect, useRef, useState } from 'react'
import { agentUsesPlanner, AGENT_STATUS, DEFAULT_AGENT_SETTINGS, TOPIC_STATUS, type AgentOverview, type AgentRunDetail, type AgentSettings } from '../../../../shared/agents'
import './ContactAgentPanel.css'
import ContactTopics from './ContactTopics'
import type { AgentFocusRequest } from '../../../../shared/agents'
import ContactResearchRecord from './ContactResearchRecord'
import type { AgentDiscussion } from './agentDiscussion'

const time = (value: number) => new Date(value).toLocaleString()
export type ContactAgentTab = 'work' | 'history' | 'memory'
export function ContactAgentPanel({ characterId, name, selectedTab, onTabChange, compact = false, focusRequest, onDiscuss, onChat }: {
  characterId: string; name: string; selectedTab?: ContactAgentTab
  onTabChange?: (tab: ContactAgentTab) => void; compact?: boolean
  focusRequest?: AgentFocusRequest
  onDiscuss?: (reference: AgentDiscussion) => void
  onChat?: () => void
}) {
  const [data, setData] = useState<AgentOverview | null>(null)
  const [draft, setDraft] = useState<AgentSettings>({ ...DEFAULT_AGENT_SETTINGS })
  const [sources, setSources] = useState('')
  const [searchKey, setSearchKey] = useState(''), [keyConfigured, setKeyConfigured] = useState(false)
  const [localTab, setLocalTab] = useState<ContactAgentTab>('work')
  const tab = selectedTab ?? localTab
  const setTab = (next: ContactAgentTab) => { setLocalTab(next); onTabChange?.(next) }
  const [detail, setDetail] = useState<AgentRunDetail | null>(null)
  const historyList = useRef<HTMLOListElement>(null)
  const record = useRef<HTMLElement>(null)
  const returnToRun = useRef<string | null>(null)
  useEffect(() => {
    if (tab !== 'history') return
    if (detail) record.current?.focus()
    else if (returnToRun.current) {
      const button = Array.from(historyList.current?.querySelectorAll('button') ?? []).find(button => button.dataset.runId === returnToRun.current)
      button?.focus()
      returnToRun.current = null
    }
  }, [detail, tab])
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [readError, setReadError] = useState('')
  const [note, setNote] = useState(''), [answer, setAnswer] = useState('')
  const epoch = useRef(0), mounted = useRef(true), initialized = useRef(false)
  const draftSnapshot = useRef<AgentSettings>({ ...DEFAULT_AGENT_SETTINGS }), savedSnapshot = useRef<string | null>(null)
  useEffect(() => {
    if (!focusRequest || focusRequest.tab !== 'history') return
    let current = true
    setDetail(null); setError('')
    void window.electronAPI.agents.detail(characterId, focusRequest.runId).then(result => {
      if (!current) return
      if (result.run.topicId !== focusRequest.topicId) throw new Error('这条记录与事项不匹配。')
      setDetail(result)
    }).catch(error => { if (current) setError(String(error instanceof Error ? error.message : error)) })
    return () => { current = false }
  }, [characterId, focusRequest])
  const refresh = async () => {
    const request = ++epoch.current
    try {
      const [next, credential] = await Promise.all([window.electronAPI.agents.get(characterId), window.electronAPI.agents.searchCredential(characterId)])
      if (!mounted.current || request !== epoch.current) return
      setData(next)
      setKeyConfigured(credential.configured)
      setReadError('')
      if (!initialized.current || JSON.stringify(draftSnapshot.current) === savedSnapshot.current) { initialized.current = true; setDraft(next.settings); setSources(next.settings.sources.join('\n')) }
      savedSnapshot.current = JSON.stringify(next.settings)
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
  draftSnapshot.current = settings
  const dirty = data && JSON.stringify(settings) !== JSON.stringify(data.settings)
  const active = data?.runs.find(r => ['running', 'waiting', 'queued', 'interrupted'].includes(r.status))
  const focusedTopic = data?.topics.find(topic => topic.id === data.focusTopicId)
  const stoppedTopic = focusedTopic && ['paused', 'completed', 'abandoned'].includes(focusedTopic.status)
  const lastRun = data?.runs[0]
  const latestReport = data?.reports[0]
  const blocked = !data?.topics.length ? '直接在聊天里告诉我需要处理什么，无需填写表单或先做设置。'
    : dirty ? '设置有未保存的修改，保存后才能推进。'
    : active ? active.status === 'waiting' ? '正在等你回复下方问题。' : '这一轮正在进行，完成后可以查看记录。'
    : stoppedTopic ? '当前事项已停止，可在事项中继续或选择其他事项。'
    : !focusedTopic ? '可以选中已有事项继续，也可以回到聊天交代新任务。'
    : data.settings.searchEnabled && !keyConfigured ? '缺少搜索密钥，请打开工作设置补充。'
    : data.callsToday + (agentUsesPlanner(data.settings) ? 2 : 1) > data.settings.dailyCalls ? '今日模型额度已用完，明日恢复后可继续。' : ''
  const discuss = (runId: string, topicId: string, text: string) => onDiscuss?.({ runId, topicId, text,
    title: data?.topics.find(topic => topic.id === topicId)?.title || '工作记录' })
  return <section className={`contact-agent${compact ? ' contact-agent-compact' : ''}`} aria-label={`${name}的持续工作`} data-contact-agent={characterId}>
    {(!compact || tab === 'work') && <>
      <div className="agent-heading"><h3>任务进展</h3><span role="status">{active ? AGENT_STATUS[active.status] : stoppedTopic ? `当前事项${TOPIC_STATUS[focusedTopic.status]}` : lastRun?.status === 'failed' ? '最近一轮失败' : !data?.topics.length ? '还没有任务' : data?.settings.enabled ? '按计划工作' : '仅手动运行'}</span></div>
      <p className="agent-description">开启持续工作后，关闭聊天仍会继续。应用需保持运行；退出或关机期间暂停，重启后恢复。</p>
    </>}
    {!compact && <div className="agent-tabs" aria-label="工作内容">
      {([['work', '任务'], ['history', '工作记录'], ['memory', '独立记忆']] as const).map(([id, label]) => <button type="button" key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}{id === 'memory' && data ? ` · ${data.memories.length}` : ''}</button>)}
    </div>}
    {(error || readError) && <div className="agent-error" role="alert">{error || readError}<button type="button" disabled={busy} onClick={() => { setError(''); setReadError(''); void refresh() }}>重新读取</button></div>}
    {!data && !error && !readError && <p role="status">正在读取工作状态…</p>}
    {data && <div hidden={tab !== 'work'}>
      <div className="agent-now">
        <span className="agent-caption">当前关注</span><strong>{focusedTopic?.title || '任务从聊天开始'}</strong>
        <p role="status">{blocked || (data.settings.enabled ? `下次检查：${data.nextAt > Date.now() ? time(data.nextAt) : '等待调度'}` : '当前为手动工作，可以推进一轮或在设置中开启持续工作。')}</p>
        <div className="agent-actions">{focusedTopic && <button data-agent-run type="button" disabled={busy || Boolean(blocked)} onClick={() => void perform(() => window.electronAPI.agents.run(characterId))}>推进当前事项一轮</button>}
          {onChat && <button type="button" className="primary" data-agent-chat onClick={onChat}>回到聊天</button>}
          {(data.settings.enabled || active) && <button type="button" disabled={busy} onClick={() => void perform(async () => { await window.electronAPI.agents.pause(characterId); setDraft(previous => ({ ...previous, enabled: false })) })}>暂停工作</button>}
        </div>
      </div>
      {latestReport && <div className="agent-latest"><span className="agent-caption">最新发现 · {time(latestReport.createdAt)}</span><h4>{latestReport.title}</h4><p className="agent-latest-excerpt">{latestReport.body}</p><p>{latestReport.nextStep || '打开记录查看结论与证据'}</p><button type="button" disabled={busy} onClick={() => { setTab('history'); setDetail(null); void perform(async () => setDetail(await window.electronAPI.agents.detail(characterId, latestReport.runId))) }}>查看结论与证据 →</button></div>}
      {lastRun?.status === 'failed' && <p className="agent-error" role="alert">{lastRun.error}</p>}
      {active?.status === 'waiting' && <form className="agent-question" onSubmit={event => { event.preventDefault(); void perform(async () => { await window.electronAPI.agents.answer(characterId, active.id, answer); setAnswer('') }) }}>
        <strong>这一步需要你的想法</strong><p>{active.question}</p>
        {onDiscuss && active.topicId && <button type="button" onClick={() => discuss(active.id, active.topicId!, `待确认问题：${active.question}`)}>带着问题去聊天</button>}
        <label>回复<textarea value={answer} maxLength={2000} onChange={e => setAnswer(e.target.value)} rows={3} required /></label>
        <button type="submit" disabled={busy || !answer.trim()}>回复并继续</button>
      </form>}
      <ContactTopics characterId={characterId} data={data} busy={busy} settingsDirty={Boolean(dirty)} onAction={perform} focusRequest={focusRequest}
        onReport={runId => { setTab('history'); setDetail(null); void perform(async () => setDetail(await window.electronAPI.agents.detail(characterId, runId))) }} />
      <details className="agent-work-settings">
      <summary>权限与额度（可选）</summary>
      <p className="agent-caption">默认配置即可在聊天中派发任务。这里只调整访问范围、运行频率和额度，保存不会创建任务。</p>
      <form onSubmit={e => { e.preventDefault(); void perform(async () => { const result = await window.electronAPI.agents.savePreferences(characterId, { ...settings, goal: settings.goal || '根据用户交付的任务整理方向、研究验证并反馈进展。' }); setDraft(result.settings); setSources(result.settings.sources.join('\n')) }) }}>
        <label>工作权限<select data-agent-permission value={draft.permissionLevel ?? 'public'} onChange={e => setDraft({ ...draft, permissionLevel: e.target.value as 'public' | 'sources', ...(e.target.value === 'sources' ? { searchEnabled: false } : {}) })}><option value="public">公开网页通行（默认）</option><option value="sources">仅指定资料</option></select><span className="agent-caption">{draft.permissionLevel === 'sources' ? '只读取下方指定网页，不自主搜索。' : '自行选择并读取公开网页，不需要逐个授权。'}</span></label>
        <details><summary>参考资料{draft.permissionLevel === 'sources' ? '（限制访问时必填）' : '（可选）'}</summary><label><span className="agent-caption">可提供希望优先关注的网页，每行一个，最多 5 个。</span><textarea data-agent-sources rows={3} value={sources} onChange={e => setSources(e.target.value)} placeholder="https://…" aria-label="参考资料" /></label></details>
        <div className="agent-settings-row"><label>间隔（分钟）<input data-agent-interval type="number" min={15} max={10080} step={1} required value={draft.intervalMinutes} onChange={e => setDraft({ ...draft, intervalMinutes: Number(e.target.value) })} /></label><label>每日模型调用上限<input type="number" min={2} max={48} step={1} required value={draft.dailyCalls} onChange={e => setDraft({ ...draft, dailyCalls: Number(e.target.value) })} /></label></div>
        <label className="agent-toggle"><input data-agent-search-enabled type="checkbox" disabled={draft.permissionLevel === 'sources'} checked={draft.searchEnabled === true} onChange={e => setDraft({ ...draft, searchEnabled: e.target.checked })} />启用搜索服务：围绕疑问发现网页</label>
        {!draft.searchEnabled && draft.permissionLevel !== 'sources' && <p className="agent-caption">未启用搜索时，会直接尝试读取已知公开网址。启用搜索服务后，可以发现更多来源。</p>}
        {draft.searchEnabled && <>
          <p className="agent-caption">每轮先制定验证计划，再读取网页；有新证据或事项调整才分析。搜索时最多 1 次搜索、3 个结果和 2 个原来源；重查时最多 5 个已知网页。研究问题会发送到 Brave Search，网页正文仍按原模型配置分析。正常一轮最多 2 次模型调用，恢复重试也计入额度。</p>
          <label>每日搜索上限<input data-agent-search-limit type="number" min={1} max={24} required value={draft.dailySearches ?? 8} onChange={e => setDraft({ ...draft, dailySearches: Number(e.target.value) })} /></label>
          {!keyConfigured && <p className="agent-error">请先在下方保存搜索密钥，再保存开启设置。</p>}
        </>}
        <label className="agent-toggle"><input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} />开启持续工作（会消耗模型额度）</label>
        <label className="agent-toggle"><input type="checkbox" checked={draft.notifyProgress !== false} onChange={e => setDraft({ ...draft, notifyProgress: e.target.checked })} />有重要进展或待确认问题时，主动发到聊天</label>
        <p className="agent-caption">每 24 小时最多 8 条；普通进展至少间隔 30 分钟，待确认问题优先。重复轮次只记历史。</p>
        <div className="agent-actions"><button data-agent-save type="submit" className="primary" disabled={busy}>保存偏好</button></div>
        {dirty && <p className="agent-caption">设置尚未保存。保存会停止当前未完成的工作。</p>}
      </form>
      <details className="agent-search-credentials"><summary>搜索服务 · {keyConfigured ? '已配置 Brave Search' : '尚未配置'}</summary>
        <p className="agent-caption">密钥仅用于此联系人，不进入工作记录或模型提示。修改密钥会停止未完成的工作。</p>
        <label>Brave Search API Key<input data-agent-search-key type="password" autoComplete="new-password" value={searchKey} onChange={e => setSearchKey(e.target.value)} placeholder={keyConfigured ? '已保存，输入新密钥以替换' : '输入搜索服务密钥'} /></label>
        <div className="agent-actions"><button data-agent-search-key-save type="button" disabled={busy || !searchKey.trim()} onClick={() => void perform(async () => { await window.electronAPI.agents.searchCredential(characterId, searchKey); setSearchKey('') })}>保存搜索密钥</button>{keyConfigured && <button type="button" disabled={busy} onClick={() => void perform(async () => { await window.electronAPI.agents.searchCredential(characterId, ''); setSearchKey('') })}>移除搜索密钥</button>}</div>
        <a href="https://api-dashboard.search.brave.com/" target="_blank" rel="noopener noreferrer">打开搜索服务控制台</a>
      </details>
      </details>
      {data.settings.searchEnabled && <p className="agent-caption">今日已搜索 {data.searchesToday ?? 0}/{data.settings.dailySearches ?? 8} 次。相同资料会延后检查，不生成重复报告。{!keyConfigured ? '搜索密钥缺失，自动研究已停止调度。' : ''}</p>}
      <p className="agent-caption">今日已调用 {data.callsToday}/{data.settings.dailyCalls} 次{data.settings.enabled && !active ? stoppedTopic ? ' · 当前事项已停止，等待你继续或选择其他事项' : ` · 下轮 ${data.callsToday + (agentUsesPlanner(data.settings) ? 2 : 1) > data.settings.dailyCalls ? '明日额度恢复后' : data.nextAt > Date.now() ? time(data.nextAt) : '等待调度'}` : ''}。连续失败 3 轮会自动暂停。</p>
    </div>}
    {data && tab === 'history' && <>
      {!detail && <p className="agent-caption">最近 30 轮。选择一轮，查看结论与证据。</p>}
      {!data.runs.length && <p className="agent-empty">还没有工作经历。第一轮完成后，便能回看想法从哪里来。</p>}
      <ol className="agent-history" ref={historyList} hidden={Boolean(detail)}>{data.runs.map(run => <li key={run.id}><button data-run-id={run.id} type="button" disabled={busy} onClick={() => void perform(async () => setDetail(await window.electronAPI.agents.detail(characterId, run.id)))}><span>{run.summary || AGENT_STATUS[run.status]}</span><small>{time(run.createdAt)} · {AGENT_STATUS[run.status]} · {data.topics.find(topic => topic.id === run.topicId)?.title || '升级前工作记录'}</small></button></li>)}</ol>
      {detail && <article className="agent-record" ref={record} tabIndex={-1} aria-label="工作记录详情"><button type="button" onClick={() => { returnToRun.current = detail.run.id; setDetail(null) }}>← 返回工作记录</button><p className="agent-caption">{time(detail.run.createdAt)} · {AGENT_STATUS[detail.run.status]}</p><h4>{detail.report?.title || detail.run.summary || AGENT_STATUS[detail.run.status]}</h4>{detail.run.error && <p role="alert">{detail.run.error}</p>}
        {detail.run.question && <div className="agent-question"><strong>这一轮的问题</strong><p>{detail.run.question}</p>{detail.run.answer && <p>你的回复：{detail.run.answer}</p>}</div>}
        {onDiscuss && detail.run.topicId && <button type="button" className="primary" onClick={() => discuss(detail.run.id, detail.run.topicId!, detail.report ? `${detail.report.title}\n${detail.report.body}\n下一步：${detail.report.nextStep}\n资料：\n${detail.report.evidence.map(source => `${source.title} ${source.url}`).join('\n')}` : detail.run.question || detail.run.summary)}>聊聊这个{detail.run.status === 'waiting' ? '问题' : '发现'}</button>}
        {detail.report && <><div className="agent-report">{detail.report.body}</div><p><strong>下一步：</strong>{detail.report.nextStep || '尚未安排'}</p><h4>当时读到的资料</h4>{detail.report.evidence.map((source, i) => <details key={source.url}><summary>[{i + 1}] {source.title}</summary><a href={source.url} target="_blank" rel="noopener noreferrer">打开原网页</a><p className="agent-caption">读取于 {time(source.capturedAt)} · 保存正文节选，非完整网页<br />SHA-256：{source.hash}</p><div className="agent-source-text">{source.text}</div></details>)}</>}
        {detail.research && <details><summary>研究过程与搜索记录</summary><ContactResearchRecord research={detail.research} /></details>}
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
