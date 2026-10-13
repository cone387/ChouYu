import { contactQueries } from './contactQueries'
import { useContactVisible } from './useContactVisible'
import ContactContextReferences from './ContactContextReferences'
import ContactMaterialLink from './ContactMaterialLink'
import ContactWorkSettings from './ContactWorkSettings'
import ContactSkills from './ContactSkills'
import ContactTaskInputForm from './ContactTaskInputForm'
import ContactAnalytics from './ContactAnalytics'
import ContactHome from './ContactHome'
import ContactMarkdown from './ContactMarkdown'
import ContactMemories from './ContactMemories'
import ContactMaterials from './ContactMaterials'
import ContactPortfolio from './ContactPortfolio'
import { captureReturnLocation, saveReturnLocation, takeReturnLocation, peekReturnLocation, validateReturnLocation } from './contactReturnLocation'
import type { DeliveryRef, TextAnchor } from '../../../../shared/contact-content'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { agentUsesPlanner, AGENT_STATUS, DEFAULT_AGENT_SETTINGS, type AgentOverview, type AgentRunDetail, type AgentSettings } from '../../../../shared/agents'
import './ContactAgentPanel.css'
import ContactTopics from './ContactTopics'
import type { AgentFocusRequest } from '../../../../shared/agents'
import ContactResearchRecord from './ContactResearchRecord'
import ContactWorkLog from './ContactWorkLog'
import type { AgentDiscussion } from './agentDiscussion'

const time = (value: number) => new Date(value).toLocaleString()
export type ContactAgentTab = 'overview' | 'work' | 'portfolio' | 'history' | 'memory' | 'materials' | 'settings' | 'analytics' | 'profile' | 'skills'
export const CONTACT_TAB_GROUPS: { label: string; tabs: [ContactAgentTab, string][] }[] = [
  { label: '日常', tabs: [['overview', '概览'], ['work', '任务'], ['portfolio', '成果']] },
  { label: '个人内容', tabs: [['memory', '独立记忆'], ['materials', '资料']] },
  { label: '工具', tabs: [['skills', '技能'], ['profile', '人设'], ['settings', '工作设置'], ['history', '工作记录'], ['analytics', '活动与消耗']] }
]
export function ContactAgentPanel({ characterId, name, selectedTab, onTabChange, compact = false, focusRequest, onDiscuss, onChat, analyticsReset, onExpand, profile, deliveryFocus, visible: surfaceVisible = true }: {
  visible?: boolean
  deliveryFocus?: { ref: DeliveryRef; anchor?: TextAnchor }
  characterId: string; name: string; selectedTab?: ContactAgentTab
  onTabChange?: (tab: ContactAgentTab) => void; compact?: boolean
  focusRequest?: AgentFocusRequest
  onDiscuss?: (reference: AgentDiscussion) => void
  onChat?: () => void
  analyticsReset?: number
  onExpand?: (tab: ContactAgentTab) => void
  profile?: ReactNode
}) {
  const visible = useContactVisible(surfaceVisible)
  const [data, setData] = useState<AgentOverview | null>(null)
  const [draft, setDraft] = useState<AgentSettings>({ ...DEFAULT_AGENT_SETTINGS })
  const [sources, setSources] = useState('')
  const [keyConfigured, setKeyConfigured] = useState(false)
  const [localTab, setLocalTab] = useState<ContactAgentTab>('overview')
  const [homeFocus, setHomeFocus] = useState<AgentFocusRequest>()
  useEffect(() => { setHomeFocus(undefined) }, [focusRequest, characterId])
  const tab = selectedTab ?? localTab
  const [returnToken, setReturnToken] = useState<string>(), [portfolioVisited, setPortfolioVisited] = useState(false)
  const returnOrigin = useRef<ReturnType<typeof captureReturnLocation>>()
  const panel = useRef<HTMLElement>(null), returnEpoch = useRef(0)
  useEffect(() => () => { returnEpoch.current++ }, [characterId])
  useEffect(() => { if (tab === 'portfolio') setPortfolioVisited(true) }, [tab])
  const setTab = (next: ContactAgentTab) => {
    returnEpoch.current++
    if (['settings', 'analytics', 'skills'].includes(next) && ['work', 'portfolio', 'overview'].includes(tab)) { const origin = captureReturnLocation(); if (origin) { returnOrigin.current = origin; setReturnToken(saveReturnLocation(origin.location)) } }
    setLocalTab(next); onTabChange?.(next)
  }
  useEffect(() => {
    const select = (event: Event) => { const request = (event as CustomEvent<{ surface: string; tab: ContactAgentTab }>).detail; if (panel.current?.closest<HTMLElement>('[data-contact-work-surface]')?.dataset.contactWorkSurface === request.surface) setTab(request.tab) }
    window.addEventListener('chouyu:contact-select-tab', select)
    return () => window.removeEventListener('chouyu:contact-select-tab', select)
  })
  const returnToContent = async () => {
    if (!returnToken) return
    const location = peekReturnLocation(returnToken)
    const ticket = ++returnEpoch.current
    try {
      if (!location) throw new Error('返回位置已失效。')
      await validateReturnLocation(location)
      if (ticket !== returnEpoch.current) return
      takeReturnLocation(returnToken); setReturnToken(undefined); setLocalTab(location.tab); onTabChange?.(location.tab)
      requestAnimationFrame(() => { const origin = returnOrigin.current; if (origin?.scroll?.isConnected) origin.scroll.scrollTop = location.scrollTop; if (origin?.focus?.isConnected) origin.focus.focus({ preventScroll: true }) })
    } catch (e) { if (ticket === returnEpoch.current) setError(e instanceof Error ? e.message : '无法返回原事项。') }
  }
  const [detail, setDetail] = useState<AgentRunDetail | null>(null)
  const [analyticsTopic, setAnalyticsTopic] = useState<string | undefined>()
  const [analyticsFilterReset, resetAnalyticsFilter] = useState(0)
  const [analyticsVisited, setAnalyticsVisited] = useState(false)
  const [analyticsRecord, setAnalyticsRecord] = useState(false)
  useEffect(() => { if (tab === 'analytics') setAnalyticsVisited(true) }, [tab])
  useEffect(() => { setAnalyticsTopic(undefined); resetAnalyticsFilter(n => n + 1) }, [analyticsReset])
  const [historyTopic, setHistoryTopic] = useState('')
  useEffect(() => {
    if (!data) return
    if (detail?.run.topicId && !data.topics.some(topic => topic.id === detail.run.topicId)) setDetail(null)
    if (historyTopic && !data.topics.some(topic => topic.id === historyTopic)) setHistoryTopic('')
  }, [data?.topics, detail?.run.topicId, historyTopic])
  useEffect(() => {
    if (!detail || !visible || tab !== 'history') return
    const runId = detail.run.id
    let alive = true, request = 0
    const update = async () => {
      const current = ++request
      try {
        const next = await contactQueries.read(characterId, 'detail', [runId], () => window.electronAPI.agents.detail(characterId, runId))
        if (alive && current === request) setDetail(next)
      } catch { /* Overview refresh exposes connection failures. */ }
    }
    const dispose = contactQueries.watch(characterId, update, 5000)
    return () => { alive = false; dispose() }
  }, [characterId, detail?.run.id, visible, tab])
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
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({})
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
      const [next, credential] = await Promise.all([contactQueries.read(characterId, 'get', [], () => window.electronAPI.agents.get(characterId)), contactQueries.read(characterId, 'searchCredential', [], () => window.electronAPI.agents.searchCredential(characterId))])
      if (!mounted.current || request !== epoch.current) return
      setData(next)
      setKeyConfigured(credential.configured)
      setReadError('')
      if (!initialized.current || JSON.stringify(draftSnapshot.current) === savedSnapshot.current) { initialized.current = true; setDraft(next.settings); setSources(next.settings.sources.join('\n')) }
      savedSnapshot.current = JSON.stringify(next.settings)
    } catch (error) { if (mounted.current && request === epoch.current) setReadError(String(error instanceof Error ? error.message : error)) }
  }
  useEffect(() => {
    if (!visible) return
    const dispose = contactQueries.watch(characterId, refresh, 5000)
    return () => { epoch.current++; dispose() }
  }, [characterId, visible])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++ } }, [characterId])
  const perform = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try { await action(); contactQueries.invalidate(characterId); await refresh() } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '操作失败，请重试。') }
    finally { if (mounted.current) setBusy(false) }
  }
  const settings = { ...draft, sources: sources.split('\n').map(s => s.trim()).filter(Boolean) }
  draftSnapshot.current = settings
  const dirty = data && JSON.stringify(settings) !== JSON.stringify(data.settings)
  const active = data?.runs.find(r => ['running', 'queued', 'interrupted'].includes(r.status)) ?? data?.runs.find(r => r.status === 'waiting')
  const focusedTopic = data?.topics.find(topic => topic.id === data.focusTopicId)
  const stoppedTopic = focusedTopic && ['paused', 'completed', 'abandoned'].includes(focusedTopic.status)
  const blocked = !data?.topics.length ? '直接在聊天里告诉我需要处理什么，无需填写表单或先做设置。'
    : dirty ? '设置有未保存的修改，保存后才能推进。'
    : active ? active.status === 'waiting' ? '有任务等你回复，请打开对应任务的概览；其他已安排任务可继续。' : '这一轮正在进行，完成后可以查看记录。'
    : stoppedTopic ? '当前事项已停止，可在事项中继续或选择其他事项。'
    : !focusedTopic ? '可以选中已有事项继续，也可以回到聊天交代新任务。'
    : data.settings.searchEnabled && !keyConfigured ? '缺少搜索密钥，请打开工作设置补充。'
    : data.callsToday + (agentUsesPlanner(data.settings) ? 2 : 1) > data.settings.dailyCalls ? '今日模型额度已用完，明日恢复后可继续。' : ''
  const discuss = (runId: string, topicId: string, text: string) => onDiscuss?.({ runId, topicId, text,
    title: data?.topics.find(topic => topic.id === topicId)?.title || '工作记录' })
  return <section ref={panel} className={`contact-agent${compact ? ' contact-agent-compact' : ''}`} aria-label={`${name}的持续工作`} data-contact-agent={characterId} data-selected-tab={tab}>
    {!compact && <div className="agent-tabs" aria-label="工作内容">
      {CONTACT_TAB_GROUPS.map(group => <div key={group.label} className="agent-tab-group" role="group" aria-label={group.label}><span className="agent-tab-group-label">{group.label}</span>{group.tabs.filter(([id]) => id !== 'profile' || profile).map(([id, label]) => <button type="button" key={id} data-agent-tab={id} aria-label={`${name}的${label}`} aria-pressed={tab === id} onClick={() => { if (id === 'analytics') { setAnalyticsTopic(undefined); resetAnalyticsFilter(n => n + 1) }; setTab(id) }}>{label}{id === 'memory' && data ? ` · ${data.memories.length}` : ''}</button>)}</div>)}
      {onExpand && <button type="button" className="agent-expand" data-agent-expand aria-label="在大窗口中打开" title="在大窗口中打开" onClick={() => onExpand(tab)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" /></svg></button>}
    </div>}
    {returnToken && ['settings', 'analytics', 'skills'].includes(tab) && <button type="button" data-contact-return onClick={() => void returnToContent()}>返回原内容</button>}
    {tab !== 'profile' && tab !== 'skills' && (error || readError) && <div className="agent-error" role="alert">{error || readError}<button type="button" disabled={busy} onClick={() => { setError(''); setReadError(''); void refresh() }}>重新读取</button></div>}
    {!data && !error && !readError && tab !== 'profile' && tab !== 'skills' && <p role="status">正在读取工作状态…</p>}
    {tab === 'profile' && profile}
    {tab === 'skills' && <ContactSkills key={characterId} characterId={characterId} name={name} />}
    {tab === 'overview' && <ContactHome active={visible} key={characterId} characterId={characterId} overview={data} onTask={topicId => { setHomeFocus({ topicId, runId: data?.runs.find(run => run.topicId === topicId)?.id || '', kind: 'progress', tab: 'work', nonce: Date.now() }); setTab('work') }} />}
    {(tab === 'portfolio' || portfolioVisited) && <div hidden={tab !== 'portfolio'}><ContactPortfolio active={visible && tab === 'portfolio'} key={characterId} characterId={characterId} initialRef={deliveryFocus?.ref} initialAnchor={deliveryFocus?.anchor} /></div>}
    {data && <div className="agent-task-view" hidden={tab !== 'work'}>
      <ContactTopics onWorkSettings={() => setTab('settings')} active={visible && tab === 'work'} onAnalytics={topicId => { setAnalyticsTopic(topicId); resetAnalyticsFilter(n => n + 1); setTab('analytics') }} characterId={characterId} data={data} busy={busy} settingsDirty={Boolean(dirty)} onAction={perform} focusRequest={homeFocus ?? focusRequest}
        renderActivity={topicId => {
          const logRun = data.runs.find(run => run.topicId === topicId)
          const draftKey = `${characterId}:${logRun?.id}:${logRun?.question}`
          const answer = answerDrafts[draftKey] ?? ''
          const setAnswer = (value: string) => setAnswerDrafts(previous => ({ ...previous, [draftKey]: value }))
          return <>
      {logRun?.status === 'waiting' && logRun.topicId === topicId && <section className="agent-question"><form onSubmit={event => { event.preventDefault(); void perform(async () => { await window.electronAPI.agents.answer(characterId, logRun.id, answer); setAnswer('') }) }}>
        <strong>这一步需要你的想法</strong><p>{logRun.question}</p>
        {onDiscuss && logRun.topicId && <button type="button" onClick={() => discuss(logRun.id, logRun.topicId!, `待确认问题：${logRun.question}`)}>带着问题去聊天</button>}
        <label>回复<textarea value={answer} maxLength={2000} onChange={e => setAnswer(e.target.value)} rows={3} required /></label>
        <button type="submit" disabled={busy || !answer.trim()}>回复并继续</button>
      </form>
      {logRun.inputFields?.length ? <details open><summary>按任务需求填写</summary><ContactTaskInputForm key={`${logRun.id}:${logRun.question}`} fields={logRun.inputFields} busy={busy} onSubmit={async (reply, values) => { await perform(async () => { await window.electronAPI.agents.answer(characterId, logRun.id, reply, values); setAnswer('') }) }} /></details> : null}
      </section>}
        {tab === 'work' && logRun && logRun.topicId === topicId && <details className="topic-secondary"><summary>本轮工作日志</summary><ContactWorkLog active={visible} key={`${characterId}:${logRun.id}`} characterId={characterId} run={logRun} data={data} busy={busy} canRetry={logRun.revisionScope === 'presentation' ? !dirty && !active && data.callsToday < data.settings.dailyCalls : !blocked}
          onReport={() => { setTab('history'); setDetail(null); void perform(async () => setDetail(await window.electronAPI.agents.detail(characterId, logRun.id))) }}
          onRetry={() => void perform(() => window.electronAPI.agents.run(characterId, logRun.topicId!))}
          onReply={() => { document.querySelector<HTMLTextAreaElement>('.agent-question textarea')?.focus() }} /></details>}
        </>}}
        onReport={runId => { setTab('history'); setDetail(null); void perform(async () => setDetail(await window.electronAPI.agents.detail(characterId, runId))) }} />
    </div>}
    {data && (analyticsVisited || tab === 'analytics') && <div hidden={tab !== 'analytics'}><ContactAnalytics resetKey={analyticsFilterReset} active={visible && tab === 'analytics'} characterId={characterId} name={name} topics={data.topics} initialTopic={analyticsTopic} onBack={() => setTab('work')}
      onReport={runId => { setAnalyticsRecord(true); setTab('history'); setDetail(null); void perform(async () => setDetail(await window.electronAPI.agents.detail(characterId, runId))) }} /></div>}
    {tab === 'history' && analyticsRecord && <button type="button" onClick={() => { setAnalyticsRecord(false); setTab('analytics') }}>← 返回活动与消耗</button>}
    {data && <div hidden={tab !== 'settings'}><ContactWorkSettings key={characterId} characterId={characterId} name={name} data={data} keyConfigured={keyConfigured} busy={busy}
 onCredentialChanged={refresh}
      onSaved={result => { setData(result); setDraft(result.settings); setSources(result.settings.sources.join('\n')); savedSnapshot.current = JSON.stringify(result.settings) }} /></div>}
    {data && tab === 'history' && <>
      {!detail && <p className="agent-caption">最近 30 轮。选择一轮，查看结论与证据。</p>}
      {!data.runs.length && <p className="agent-empty">还没有工作经历。第一轮完成后，便能回看想法从哪里来。</p>}
      {!detail && <label className="agent-history-filter">查看任务<select aria-label="筛选工作记录" value={historyTopic} onChange={event => setHistoryTopic(event.target.value)}><option value="">全部任务</option>{data.topics.map(topic => <option key={topic.id} value={topic.id}>{topic.title}</option>)}</select></label>}
      <ol className="agent-history" ref={historyList} hidden={Boolean(detail)}>{data.runs.filter(run => !historyTopic || run.topicId === historyTopic).map((run, index, runs) => {
        const date = new Date(run.createdAt).toLocaleDateString()
        const startsDay = index === 0 || date !== new Date(runs[index - 1].createdAt).toLocaleDateString()
        return <li key={run.id}>
          {startsDay && <h4 className="agent-history-date">{date}</h4>}
          <div className="agent-history-entry" data-status={run.status}>
            <time dateTime={new Date(run.createdAt).toISOString()}>{new Date(run.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
            <button data-run-id={run.id} type="button" disabled={busy} onClick={() => void perform(async () => setDetail(await window.electronAPI.agents.detail(characterId, run.id)))}>
              <span className="agent-history-meta"><span>{data.topics.find(topic => topic.id === run.topicId)?.title || '升级前工作记录'}</span><span className="topic-badge">{AGENT_STATUS[run.status]}</span></span>
              <strong>{run.summary || AGENT_STATUS[run.status]}</strong>
              <span className="agent-history-link">查看本轮结论与过程 →</span>
            </button>
          </div>
        </li>
      })}</ol>
      {!detail && historyTopic && !data.runs.some(run => run.topicId === historyTopic) && <p className="agent-empty">最近 30 轮中没有这个任务的记录。更早的记录可从任务的历史变化中查看。</p>}
      {detail && <article className="agent-record" ref={record} tabIndex={-1} aria-label="工作记录详情"><button type="button" onClick={() => { returnToRun.current = detail.run.id; setDetail(null) }}>← 返回工作记录</button><p className="agent-caption">{time(detail.run.createdAt)} · {AGENT_STATUS[detail.run.status]}</p><h4>{detail.report?.title || detail.run.summary || AGENT_STATUS[detail.run.status]}</h4>{detail.run.error && <p role="alert">{detail.run.error}</p>}
        {detail.run.contactContext && <ContactContextReferences record={detail.run.contactContext} />}
        {detail.run.question && <div className="agent-question"><strong>这一轮的问题</strong><p>{detail.run.question}</p>{detail.run.answer && <p>你的回复：{detail.run.answer}</p>}</div>}
        {onDiscuss && detail.run.topicId && <button type="button" className="primary" onClick={() => discuss(detail.run.id, detail.run.topicId!, detail.report ? `${detail.report.title}\n${detail.report.body}\n下一步：${detail.report.nextStep}\n资料：\n${detail.report.evidence.map(source => `${source.title} ${source.url}`).join('\n')}` : detail.run.question || detail.run.summary)}>聊聊这个{detail.run.status === 'waiting' ? '问题' : '发现'}</button>}
        {detail.report && <><div className="agent-report"><ContactMarkdown>{detail.report.body}</ContactMarkdown></div><p><strong>下一步：</strong>{detail.report.nextStep || '尚未安排'}</p><h4>当时读到的资料</h4>{detail.report.evidence.map((source, i) => <details key={source.url}><summary>[{i + 1}] {source.title}</summary><ContactMaterialLink href={source.url}>{source.title}</ContactMaterialLink><p className="agent-caption">读取于 {time(source.capturedAt)} · 保存正文节选，非完整网页<br />SHA-256：{source.hash}</p><div className="agent-source-text">{source.text}</div></details>)}</>}
        {detail.research && <details><summary>研究过程与搜索记录</summary><ContactResearchRecord research={detail.research} /></details>}
        <details><summary>查看工作经过 · {detail.events.length} 条记录</summary><ol>{detail.events.map(event => <li key={event.id}><time>{time(event.at)}</time><p>{event.text}</p></li>)}</ol></details>
      </article>}
    </>}
    {data && tab === 'materials' && <ContactMaterials key={characterId} owner={characterId} topics={data.topics} />}
    {data && tab === 'memory' && <ContactMemories key={characterId} characterId={characterId} name={name} data={data} onSaved={setData} />}
  </section>
}
