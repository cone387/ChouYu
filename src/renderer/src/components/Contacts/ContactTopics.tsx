import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { AGENT_STATUS, TOPIC_STATUS, type AgentOverview, type AgentTopic, type AgentTopicDetail, type AgentTopicInput, type AgentTopicStatus } from '../../../../shared/agents'
import './ContactTopics.css'
import type { AgentFocusRequest } from '../../../../shared/agents'
import ContactDelivery from './ContactDelivery'
import ContactTaskIcon from './ContactTaskIcon'
import ContactTaskOverview from './ContactTaskOverview'

type Editor = { kind: 'edit' | 'status'; topicId: string; revision: number; input: AgentTopicInput; status: AgentTopicStatus; reason: string }
const researchable = (topic: AgentTopic) => ['planned', 'researching', 'needs_evidence'].includes(topic.status)
const tabs = [['overview', '概览'], ['stages', '阶段计划'], ['delivery', '任务成果'], ['activity', '工作过程'], ['history', '历史记录']] as const
type TopicTab = typeof tabs[number][0]
const time = (value: number) => new Date(value).toLocaleString()

export default function ContactTopics({ characterId, data, busy, settingsDirty, onAction, onReport, focusRequest, renderActivity }: {
  characterId: string; data: AgentOverview; busy: boolean; settingsDirty: boolean
  onAction: (action: () => Promise<unknown>) => Promise<void>; onReport: (runId: string, topicId: string) => void
  focusRequest?: AgentFocusRequest
  renderActivity?: (topicId: string) => ReactNode
}) {
  const tabId = useId()
  const [tab, setTab] = useState<TopicTab>('overview')
  const [showSettings, setShowSettings] = useState(false)
  const [runAction, setRunAction] = useState<'start' | 'pause' | null>(null)
  const settingsButton = useRef<HTMLButtonElement>(null)
  const settingsPane = useRef<HTMLDivElement>(null)
  const scrollPane = useRef<HTMLDivElement>(null)
  useEffect(() => { if (showSettings) settingsPane.current?.focus() }, [showSettings])
  useEffect(() => { scrollPane.current?.scrollTo(0, 0) }, [tab, showSettings])
  const [selected, setSelected] = useState(data.focusTopicId ?? data.topics[0]?.id ?? '')
  const [mobileDetail, setMobileDetail] = useState(Boolean(focusRequest))
  useEffect(() => { if (focusRequest) { setSelected(focusRequest.topicId); setMobileDetail(true) } }, [focusRequest])
  const [detail, setDetail] = useState<AgentTopicDetail | null>(null)
  const [loading, setLoading] = useState(false), [error, setError] = useState('')
  const [editor, setEditor] = useState<Editor | null>(null)
  // Explicitly changing the working topic selects it; ordinary refreshes preserve browsing.
  useEffect(() => { if (!editor && data.focusTopicId) setSelected(data.focusTopicId) }, [data.focusTopicId])
  const epoch = useRef(0)
  const topic = data.topics.find(item => item.id === selected)
  const currentRun = data.runs.find(run => ['queued', 'running', 'waiting', 'interrupted'].includes(run.status))
  const canPause = Boolean(topic && (currentRun?.topicId === topic.id || (data.settings.enabled && data.focusTopicId === topic.id && researchable(topic))))
  const waiting = currentRun?.topicId === topic?.id && currentRun?.status === 'waiting'
  useEffect(() => { setTab(focusRequest?.topicId === selected && focusRequest.kind === 'question' ? 'activity' : 'overview'); setShowSettings(false) }, [selected, focusRequest])
  const topicRun = data.runs.find(run => run.topicId === topic?.id)
  useEffect(() => {
    // A just-created topic can arrive before the parent's overview refresh.
    // Keep its selected ID while that response is in flight.
    if (!selected) setSelected(data.focusTopicId ?? data.topics[0]?.id ?? '')
  }, [data.topics, data.focusTopicId, selected])
  const load = async (cursor?: number) => {
    const request = ++epoch.current
    setLoading(true); setError('')
    try {
      const result = await window.electronAPI.agents.topicDetail(characterId, selected, cursor)
      if (request !== epoch.current) return
      setDetail(previous => cursor && previous?.topic.id === result.topic.id ? { ...result, changes: [...previous.changes, ...result.changes] } : result)
    } catch (error) { if (request === epoch.current) setError(error instanceof Error ? error.message : '事项记录读取失败。') }
    finally { if (request === epoch.current) setLoading(false) }
  }
  useEffect(() => {
    setDetail(null)
    if (selected) void load()
    return () => { epoch.current++ }
  }, [characterId, selected, topic?.revision])
  const edit = (kind: 'edit' | 'status', status: AgentTopicStatus = 'planned') => {
    if (topic) setEditor({ kind, topicId: topic.id, revision: topic.revision, input: { title: topic.title, goal: topic.goal, constraints: topic.constraints }, status, reason: '' })
  }
  const submit = () => onAction(async () => {
    if (!editor) return
    if (editor.kind === 'edit') await window.electronAPI.agents.editTopic(characterId, editor.topicId, editor.revision, editor.input, editor.reason)
    else await window.electronAPI.agents.topicStatus(characterId, editor.topicId, editor.revision, editor.status, editor.reason)
    setEditor(null)
  })
  return <section className="contact-topics" aria-label="持续推进的事项">
    {!data.topics.length && <p className="agent-empty">在聊天里直接交代任务，这里会显示进度和每一轮的判断。</p>}
    {data.topics.length > 0 && <div className={`topic-workspace${mobileDetail ? ' topic-show-detail' : ''}`}>
      <nav className="topic-list" aria-label="任务列表">
        <div className="topic-list-heading"><strong>任务列表</strong><span>{data.topics.length}</span></div>
        {data.topics.map(item => {
          const run = currentRun?.topicId === item.id ? currentRun : undefined
          return <button type="button" key={item.id} className="topic-list-card" data-topic-id={item.id}
            aria-current={selected === item.id ? 'true' : undefined} disabled={busy || Boolean(editor)}
            onClick={() => { setSelected(item.id); setMobileDetail(true) }}>
            <span className="topic-card-title">{item.title}</span>
            <span className="topic-badges">
              {item.id === data.focusTopicId && <span className="topic-badge topic-badge-focus">当前关注</span>}
              <span className={`topic-badge${run ? ' topic-badge-active' : ''}`}>{run ? AGENT_STATUS[run.status] : TOPIC_STATUS[item.status]}</span>
            </span>
            <span className="topic-card-times">
              <span title="任务建立时间">开始 <time dateTime={new Date(item.createdAt).toISOString()}>{new Date(item.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}</time></span>
              <span>更新 <time dateTime={new Date(item.updatedAt).toISOString()}>{new Date(item.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}</time></span>
            </span>
          </button>
        })}
      </nav>
      <div className="topic-detail-pane" key={selected}>
        <button type="button" className="topic-back" onClick={() => setMobileDetail(false)}>← 返回任务列表</button>
    {topic && <>
      <header className="topic-fixed-header" data-topic-current={topic.id}>
        <div className="topic-title-group"><h4>{topic.title}</h4><span className="topic-status">{TOPIC_STATUS[topic.status]}</span></div>
        <div className="topic-header-actions">
          <button type="button" className="primary" data-topic-run={!canPause || undefined} data-topic-pause={canPause || undefined}
            disabled={busy || Boolean(editor) || Boolean(runAction) || (!canPause && (settingsDirty || Boolean(currentRun)))}
            onClick={() => {
              setRunAction(canPause ? 'pause' : 'start')
              void onAction(() => canPause
                ? window.electronAPI.agents.topicStatus(characterId, topic.id, topic.revision, 'paused', '用户暂停任务')
                : window.electronAPI.agents.continueTopic(characterId, topic.id, topic.revision, '用户启动任务')).finally(() => setRunAction(null))
            }}><ContactTaskIcon name={canPause ? 'pause' : 'play'} />{runAction === 'pause' ? '暂停中…' : runAction === 'start' ? '启动中…' : canPause ? '暂停' : '启动'}</button>
          <button ref={settingsButton} type="button" data-topic-settings aria-expanded={showSettings} aria-controls={`${tabId}-settings`} disabled={busy || Boolean(editor)} onClick={() => setShowSettings(value => !value)}><ContactTaskIcon name="settings" />设置</button>
        </div>
      </header>
      <div className="topic-content-tabs" role="tablist" aria-label="任务内容" hidden={showSettings}>
        {tabs.map(([id, label], index) => <button type="button" role="tab" key={id} id={`${tabId}-${id}`} aria-controls={`${tabId}-${id}-panel`} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1}
          onClick={() => setTab(id)} onKeyDown={event => {
            const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1
            if (next < 0) return
            event.preventDefault(); setTab(tabs[next][0]); document.getElementById(`${tabId}-${tabs[next][0]}`)?.focus()
          }}>{label}{id === 'activity' && waiting && <span className="topic-waiting">待回复</span>}</button>)}
      </div>
      <div className="topic-content-scroll" ref={scrollPane}>
      <div ref={settingsPane} id={`${tabId}-settings`} className="topic-settings" hidden={!showSettings} tabIndex={-1} aria-label="本任务设置">
        <div className="topic-heading"><h4>本任务设置</h4><button type="button" disabled={Boolean(editor)} onClick={() => { setShowSettings(false); settingsButton.current?.focus() }}>返回任务</button></div>
        <p className="agent-caption">以下调整仅针对当前任务。</p>
        {!editor && <><dl><dt>目标</dt><dd>{topic.goal}</dd><dt>约束与边界</dt><dd>{topic.constraints || '未设置约束。'}</dd></dl>
        <div className="agent-actions"><button type="button" disabled={busy} onClick={() => edit('edit')}>编辑任务</button>
        {researchable(topic) && <><button type="button" disabled={busy} onClick={() => edit('status', 'completed')}>结束事项</button><button type="button" disabled={busy} onClick={() => edit('status', 'abandoned')}>放弃事项</button></>}
        </div></>}
    {editor && <form className="topic-editor" data-topic-editor onSubmit={event => { event.preventDefault(); void submit() }}>
      <h4>{editor.kind === 'edit' ? '编辑事项' : `${TOPIC_STATUS[editor.status]}：${editor.input.title}`}</h4>
      {editor.kind === 'edit' && <>
        <label>事项标题<input data-topic-title value={editor.input.title} maxLength={160} required onChange={event => setEditor({ ...editor, input: { ...editor.input, title: event.target.value } })} /></label>
        <label>要解决的问题与目标<textarea data-topic-goal rows={3} value={editor.input.goal} maxLength={2000} required onChange={event => setEditor({ ...editor, input: { ...editor.input, goal: event.target.value } })} /></label>
        <label>约束与边界<textarea data-topic-constraints rows={2} value={editor.input.constraints} maxLength={2000} onChange={event => setEditor({ ...editor, input: { ...editor.input, constraints: event.target.value } })} placeholder="例如预算、适用人群、不能采用的方案" /></label>
      </>}
      <label>调整原因<textarea data-topic-reason rows={2} required maxLength={2000} value={editor.reason} onChange={event => setEditor({ ...editor, reason: event.target.value })} /></label>
      <p className="agent-caption">会停止该事项当前未完成的运行，已有判断与证据保留在历史中。</p>
      <div className="agent-actions"><button type="submit" data-topic-save className="primary" disabled={busy}>保存事项</button><button type="button" disabled={busy} onClick={() => setEditor(null)}>取消</button></div>
    </form>}
      </div>
      <div hidden={showSettings}>
      <section role="tabpanel" id={`${tabId}-overview-panel`} aria-labelledby={`${tabId}-overview`} hidden={tab !== 'overview'} tabIndex={0}>
        <ContactTaskOverview topic={topic} data={data} visible={tab === 'overview' && !showSettings} />
      </section>
      <section role="tabpanel" id={`${tabId}-${tab === 'stages' ? 'stages' : 'delivery'}-panel`} aria-labelledby={`${tabId}-${tab === 'stages' ? 'stages' : 'delivery'}`} hidden={tab !== 'stages' && tab !== 'delivery'} tabIndex={0}>
      <ContactDelivery key={`${characterId}:${topic.id}`} view={tab === 'stages' ? 'stages' : 'delivery'} characterId={characterId} topic={topic} busy={busy || Boolean(currentRun) || settingsDirty || Boolean(editor)} onAction={onAction} onReport={topicRun ? () => onReport(topicRun.id, topic.id) : undefined} />
      <div hidden={tab !== 'stages'}>
      <article className="topic-current">
        <p className="agent-caption">本轮执行：{currentRun?.topicId === topic.id ? AGENT_STATUS[currentRun.status] : topicRun?.status === 'failed' ? '最近一轮失败，当前未执行' : topicRun?.status === 'completed' ? '最近一轮已完成，当前未执行' : '当前未执行'}</p>
        <p className="agent-caption">{topic.status === 'paused' ? '任务已暂停，已有成果保留。' : data.settings.enabled && data.focusTopicId === topic.id && researchable(topic) ? '持续工作已开启，本轮结束后会按工作设置继续。' : '启动后执行一轮；可在工作设置中开启持续工作。'}</p>
        {topic.nextStep && <p className="topic-next-step"><strong>下一步：</strong>{topic.nextStep}</p>}
        {settingsDirty && <p className="agent-caption">工作设置尚未保存，保存后再推进事项。</p>}
        {currentRun && currentRun.topicId !== topic.id && <p className="agent-caption">联系人正在处理另一事项，完成后可推进这一项。</p>}
      </article>
      <details className="topic-goal"><summary>进展说明</summary><dl><dt>当前判断</dt><dd data-topic-judgement>{topic.judgement || '尚未形成判断。'}</dd>{topic.openQuestions && <><dt>待验证问题</dt><dd>{topic.openQuestions}</dd></>}{['completed', 'abandoned', 'paused'].includes(topic.status) && <><dt>停止原因</dt><dd>{topic.reason}</dd></>}</dl></details>
      <details className="topic-goal"><summary>目标与约束</summary><dl><dt>目标</dt><dd>{topic.goal}</dd>{topic.constraints && <><dt>约束</dt><dd>{topic.constraints}</dd></>}</dl></details>
      </div>
      </section>
      <section role="tabpanel" id={`${tabId}-activity-panel`} aria-labelledby={`${tabId}-activity`} hidden={tab !== 'activity'} tabIndex={0}>
        <h4>{waiting ? '需要你回复' : '工作过程'}</h4>
        {topicRun ? renderActivity?.(topic.id) : <p className="agent-empty">任务尚未启动，执行后会在这里显示工作过程。</p>}
      </section>
      <section role="tabpanel" id={`${tabId}-history-panel`} aria-labelledby={`${tabId}-history`} hidden={tab !== 'history'} tabIndex={0}>
      <div className="topic-timeline"><h4>历史记录</h4>
        {loading && <p role="status">正在读取事项经历…</p>}
        {error && <p role="alert" className="agent-error">{error}<button type="button" onClick={() => void load()}>重试</button></p>}
        <ol>{detail?.changes.map(change => <li key={change.id} data-topic-change={change.id}>
          <span className="agent-caption">{time(change.createdAt)} · {change.kind === 'research' ? '本轮研究' : change.kind === 'created' ? '建立事项' : change.kind === 'planned' ? '联系人整理方向' : '用户调整'}</span>
          <p>{change.reason}</p>
          {change.before && change.before.status !== change.after.status && <p className="agent-caption">{TOPIC_STATUS[change.before.status]} → {TOPIC_STATUS[change.after.status]}</p>}
          <details><summary>查看这次的判断与下一步</summary>
            {change.before && <><strong>此前判断</strong><p>{change.before.judgement || '尚无判断'}</p></>}
            <strong>当时判断</strong><p>{change.after.judgement || '尚无判断'}</p>
            <strong>当时目标与约束</strong><p>{change.after.goal}{change.after.constraints ? `\n${change.after.constraints}` : ''}</p>
            <strong>待验证问题</strong><p>{change.after.openQuestions || '未记录'}</p>
            <strong>下一步</strong><p>{change.after.nextStep || '未安排'}</p>
          </details>
          {change.runId && <button type="button" data-topic-evidence disabled={busy} onClick={() => onReport(change.runId!, topic.id)}>查看本轮报告与证据</button>}
        </li>)}</ol>
        {detail?.nextCursor && <button type="button" disabled={loading} onClick={() => void load(detail.nextCursor!)}>更早的经历</button>}
      </div>
      </section>
      </div>
      </div>
    </>}
      </div>
    </div>}
  </section>
}
