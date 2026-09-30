import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { AGENT_STATUS, TOPIC_STATUS, type AgentOverview, type AgentTopic, type AgentTopicDetail, type AgentTopicInput, type AgentTopicStatus } from '../../../../shared/agents'
import './ContactTopics.css'
import type { AgentFocusRequest } from '../../../../shared/agents'
import ContactDelivery from './ContactDelivery'
import ContactTaskIcon from './ContactTaskIcon'
import ContactTaskOverview from './ContactTaskOverview'
import ContactTaskInteractions from './ContactTaskInteractions'
import ContactTaskDialog from './ContactTaskDialog'
import ContactTaskSettingsDialog from './ContactTaskSettingsDialog'
import ContactTaskResources from './ContactTaskResources'
import TaskIcon from '../Tasks/TaskIcon'
import { DEFAULT_CHARACTER_ID } from '../../../../shared/characters'
import { AssistantTaskDetail, useAssistantTasks } from './AssistantTaskEntries'

type Editor = { kind: 'edit' | 'status'; topicId: string; revision: number; input: AgentTopicInput; status: AgentTopicStatus; reason: string }
const researchable = (topic: AgentTopic) => ['planned', 'researching', 'needs_evidence'].includes(topic.status)
const tabs = [['overview', '概览'], ['stages', '阶段计划'], ['delivery', '任务成果'], ['interactions', '互动记录'], ['history', '历史记录']] as const
type TopicTab = typeof tabs[number][0]
const time = (value: number) => new Date(value).toLocaleString()
const elapsedTime = (milliseconds: number) => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  return `${Math.floor(seconds / 3600) ? `${Math.floor(seconds / 3600)}:` : ''}${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export default function ContactTopics({ characterId, data, busy, settingsDirty, onAction, onReport, focusRequest, renderActivity, onAnalytics, active = true }: {
  characterId: string; data: AgentOverview; busy: boolean; settingsDirty: boolean
  onAction: (action: () => Promise<unknown>) => Promise<void>; onReport: (runId: string, topicId: string) => void
  onAnalytics: (topicId: string) => void
  focusRequest?: AgentFocusRequest
  renderActivity?: (topicId: string) => ReactNode
  active?: boolean
}) {
  const tabId = useId()
  const assistant = useAssistantTasks(characterId === DEFAULT_CHARACTER_ID && active)
  const [listCollapsed, setListCollapsed] = useState(false)
  const [stagesCollapsed, setStagesCollapsed] = useState(false)
  const [taskDialog, setTaskDialog] = useState<'create' | AgentTopic | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    const close = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(null) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenu(null); document.querySelector<HTMLButtonElement>(`[data-task-menu="${menu}"]`)?.focus() } }
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape)
    menuRef.current?.querySelector<HTMLButtonElement>('[data-task-delete]')?.focus()
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape) }
  }, [menu])
  const [tab, setTab] = useState<TopicTab>('overview')
  const [showSettings, setShowSettings] = useState(false)
  const [runAction, setRunAction] = useState<'start' | 'pause' | null>(null)
  const [settingsError, setSettingsError] = useState('')
  const settingsButton = useRef<HTMLButtonElement>(null)
  const scrollPane = useRef<HTMLDivElement>(null)
  useEffect(() => { scrollPane.current?.scrollTo(0, 0) }, [tab])
  const [selected, setSelected] = useState(data.focusTopicId ?? data.topics[0]?.id ?? '')
  const [mobileDetail, setMobileDetail] = useState(Boolean(focusRequest))
  useEffect(() => { if (focusRequest) { setSelected(focusRequest.topicId); setMobileDetail(true) } }, [focusRequest])
  const [detail, setDetail] = useState<AgentTopicDetail | null>(null)
  const [loading, setLoading] = useState(false), [error, setError] = useState('')
  const [editor, setEditor] = useState<Editor | null>(null)
  // Background scheduling must not switch away from the task being read or answered.
  const epoch = useRef(0)
  const topic = data.topics.find(item => item.id === selected)
  const assistantTask = assistant.entries.find(item => item.id === selected)
  const currentRun = data.runs.find(run => run.topicId === topic?.id && ['queued', 'running', 'waiting', 'interrupted'].includes(run.status))
  const otherRunning = data.runs.some(run => run.topicId !== topic?.id && ['queued', 'running', 'interrupted'].includes(run.status))
  const queued = Boolean(topic && data.queuedTopicIds?.includes(topic.id))
  const canPause = Boolean(topic && (queued || currentRun?.topicId === topic.id || (data.settings.enabled && data.focusTopicId === topic.id && researchable(topic))))
  const waiting = currentRun?.topicId === topic?.id && currentRun?.status === 'waiting'
  useEffect(() => { setTab('overview'); setShowSettings(false); setEditor(null); setSettingsError('') }, [selected, focusRequest])
  useEffect(() => {
    if (tab !== 'overview' || showSettings || !waiting || focusRequest?.kind !== 'question') return
    scrollPane.current?.querySelector<HTMLTextAreaElement>('.agent-question textarea')?.focus()
  }, [tab, showSettings, waiting, focusRequest])
  const topicRun = data.runs.find(run => run.topicId === topic?.id)
  const activeRun = currentRun?.topicId === topic?.id ? currentRun : undefined
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    setNow(Date.now())
    if (activeRun?.status !== 'running') return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [activeRun?.id, activeRun?.status])
  const executionLabel = activeRun?.status === 'running' ? `运行中 · 本轮 ${elapsedTime(now - activeRun.createdAt)}`
    : activeRun?.status === 'waiting' ? '待回复 · 暂停'
    : activeRun?.status === 'queued' ? '排队中 · 暂停'
    : activeRun?.status === 'interrupted' ? '恢复中 · 暂停'
    : queued ? '排队中 · 暂停'
    : canPause ? '等待续跑 · 暂停'
    : topicRun?.status === 'failed' ? '执行失败 · 重试' : '启动'
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
    if (topic) void load()
    return () => { epoch.current++ }
  }, [characterId, selected, topic?.revision])
  const edit = (kind: 'edit' | 'status', status: AgentTopicStatus = 'planned') => {
    if (topic) setEditor({ kind, topicId: topic.id, revision: topic.revision, input: { title: topic.title, goal: topic.goal, constraints: topic.constraints }, status, reason: '' })
  }
  const settingsAction = (action: () => Promise<unknown>) => {
    setSettingsError('')
    return onAction(async () => {
      try { return await action() }
      catch (error) { setSettingsError(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '保存失败，请重试。'); throw error }
    })
  }
  const submit = () => settingsAction(async () => {
    if (!editor) return
    if (editor.kind === 'edit') await window.electronAPI.agents.editTopic(characterId, editor.topicId, editor.revision, editor.input, editor.reason)
    else await window.electronAPI.agents.topicStatus(characterId, editor.topicId, editor.revision, editor.status, editor.reason)
    setEditor(null)
  })
  const stageToggle = <button type="button" className="topic-stage-toggle" aria-label={stagesCollapsed ? '展开任务阶段' : '折叠任务阶段'} title={stagesCollapsed ? '展开任务阶段' : '折叠任务阶段'} aria-expanded={!stagesCollapsed} aria-controls={`${tabId}-stages-nav`} onClick={() => setStagesCollapsed(value => !value)}><TaskIcon name="sidebar" /></button>
  const closeSettings = () => { setShowSettings(false); setEditor(null); setSettingsError('') }
  return <section className="contact-topics" aria-label="持续推进的事项">
    {taskDialog && <ContactTaskDialog characterId={characterId} task={taskDialog === 'create' ? undefined : taskDialog} onClose={() => setTaskDialog(null)} onAction={onAction}
      onRoutineDone={item => { void assistant.refresh(); setSelected(`routine:${item.id}`); setMobileDetail(true) }} onDone={next => {
      if (taskDialog === 'create') { setSelected(next.topics.find(item => !data.topics.some(previous => previous.id === item.id))?.id ?? next.topics[0]?.id ?? ''); setMobileDetail(true) }
      else if (selected === taskDialog.id) { setSelected(next.focusTopicId ?? next.topics[0]?.id ?? ''); setMobileDetail(false) }
    }} />}
    <div className={`topic-workspace${mobileDetail ? ' topic-show-detail' : ''}${listCollapsed ? ' topic-list-collapsed' : ''}${stagesCollapsed ? ' topic-stages-collapsed' : ''}`}>
      <aside className="topic-list-rail">
        <div className="topic-list-toolbar"><span>任务列表 · {data.topics.length + assistant.entries.length}</span></div>
      <nav id={`${tabId}-list`} className="topic-list" aria-label="任务列表">
        <button type="button" className="topic-create" data-topic-create disabled={busy || Boolean(editor)} onClick={() => setTaskDialog('create')}><TaskIcon name="plus" />新建任务</button>
        {assistant.error && <p role="alert" className="agent-error">{assistant.error}<button onClick={() => void assistant.refresh()}>重试</button></p>}
        {!data.topics.length && !assistant.entries.length && <p className="agent-empty">还没有任务，描述你想完成的事情即可。</p>}
        {assistant.entries.map(item => <div key={item.id} className="topic-list-item"><button type="button" className="topic-list-card" data-assistant-task={item.id} aria-current={selected === item.id ? 'true' : undefined}
          disabled={busy || Boolean(editor)} onClick={() => { setSelected(item.id); setMobileDetail(true) }}>
          <span className="topic-card-title">{item.title}</span><span className="topic-badges"><span className="topic-badge">{item.status}</span></span>
        </button></div>)}
        {data.topics.map(item => {
          const run = data.runs.find(run => run.topicId === item.id && ['queued', 'running', 'waiting', 'interrupted'].includes(run.status))
          return <div key={item.id} className="topic-list-item"><button type="button" className="topic-list-card" data-topic-id={item.id}
            aria-current={selected === item.id ? 'true' : undefined} disabled={busy || Boolean(editor)}
            onClick={() => { setSelected(item.id); setMobileDetail(true) }}>
            <span className="topic-card-title">{item.title}</span>
            <span className="topic-badges">
              {item.id === data.focusTopicId && <span className="topic-badge topic-badge-focus">当前关注</span>}
              <span className={`topic-badge${run ? ' topic-badge-active' : ''}`}>{data.queuedTopicIds?.includes(item.id) ? '排队中' : run ? AGENT_STATUS[run.status] : TOPIC_STATUS[item.status]}</span>
            </span>
            <span className="topic-card-times">
              <span title="任务建立时间">开始 <time dateTime={new Date(item.createdAt).toISOString()}>{new Date(item.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}</time></span>
              <span>更新 <time dateTime={new Date(item.updatedAt).toISOString()}>{new Date(item.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}</time></span>
            </span>
          </button><div className={`topic-card-menu${menu === item.id ? ' is-open' : ''}`} ref={menu === item.id ? menuRef : undefined}>
            <button type="button" data-task-menu={item.id} aria-label={`「${item.title}」的操作`} aria-expanded={menu === item.id} disabled={busy || Boolean(editor)} onClick={() => setMenu(menu === item.id ? null : item.id)}><TaskIcon name="more" /></button>
            {menu === item.id && <div className="topic-card-menu-popover"><button type="button" data-task-delete onClick={() => { setMenu(null); setTaskDialog(item) }}><TaskIcon name="trash" />删除任务</button></div>}
          </div></div>
        })}
      </nav>
      </aside>
      <aside id={`${tabId}-stages-nav`} className="topic-stage-nav" aria-label="任务阶段导航">
        <div className="topic-stage-heading"><button type="button" className="topic-list-toggle" aria-label={listCollapsed ? '展开任务列表' : '折叠任务列表'} title={listCollapsed ? '展开任务列表' : '折叠任务列表'} aria-expanded={!listCollapsed} aria-controls={`${tabId}-list`} onClick={() => { setListCollapsed(value => !value); setMenu(null) }}><TaskIcon name="sidebar" /></button><span>任务阶段</span></div>
        <button type="button" className="topic-back" onClick={() => setMobileDetail(false)}>← 任务列表</button>
        {topic ? <>
      <div className="topic-content-tabs" role="tablist" aria-label="任务阶段" aria-orientation="vertical">
        {tabs.map(([id, label], index) => <button type="button" role="tab" key={id} id={`${tabId}-${id}`} aria-controls={`${tabId}-${id}-panel`} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1}
          onClick={() => { setTab(id); setShowSettings(false) }} onKeyDown={event => {
            const next = (event.key === 'ArrowDown' || event.key === 'ArrowRight') ? (index + 1) % tabs.length : (event.key === 'ArrowUp' || event.key === 'ArrowLeft') ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1
            if (next < 0) return
            event.preventDefault(); setShowSettings(false); setTab(tabs[next][0]); document.getElementById(`${tabId}-${tabs[next][0]}`)?.focus()
          }}>{label}{id === 'overview' && waiting && <span className="topic-waiting">待回复</span>}</button>)}
      </div>
        </> : assistantTask ? <div className="topic-content-tabs"><button type="button" aria-current="page">概览</button></div> : <p className="agent-caption">选择任务后查看</p>}
      </aside>
      <div className="topic-detail-pane" key={selected}>
        {!topic && <div className="topic-content-scroll"><header className="topic-content-header">
          {stagesCollapsed && <button type="button" className="topic-back topic-detail-back" onClick={() => setMobileDetail(false)}>← 任务列表</button>}
          <div className="topic-title-group">{stageToggle}<h4>{assistantTask?.title ?? '任务详情'}</h4></div></header>
          {assistantTask ? <AssistantTaskDetail key={assistantTask.id} entry={assistantTask} config={assistant.config} onChanged={assistant.refresh} onSelect={setSelected} />
            : <p className="agent-empty">{selected ? '任务已删除或不存在，请从列表选择其他任务。' : '选择或新建任务，在这里查看进度与成果。'}</p>}
        </div>}
    {topic && <>
      <div className="topic-floating-action" data-running={activeRun?.status === 'running' || undefined}>
          <button type="button" className="primary" data-topic-run={!canPause || undefined} data-topic-pause={canPause || undefined}
            title={activeRun?.status === 'running' ? '本轮从开始到现在的耗时（含排队和等待回复），点击暂停；累计耗时见概览统计。' : canPause ? '点击暂停当前任务' : '启动本任务一轮工作'}
            disabled={busy || Boolean(editor) || Boolean(runAction) || (!canPause && (settingsDirty || otherRunning))}
            onClick={() => {
              setRunAction(canPause ? 'pause' : 'start')
              void onAction(() => canPause
                ? window.electronAPI.agents.topicStatus(characterId, topic.id, topic.revision, 'paused', '用户暂停任务')
                : window.electronAPI.agents.continueTopic(characterId, topic.id, topic.revision, '用户启动任务')).finally(() => setRunAction(null))
            }}><ContactTaskIcon name={canPause ? 'pause' : 'play'} />{runAction === 'pause' ? '暂停中…' : runAction === 'start' ? '启动中…' : executionLabel}</button>
          <button type="button" aria-label="查看本任务的活动与消耗" title="活动与消耗" onClick={() => onAnalytics(topic.id)}><TaskIcon name="chart" />消耗</button>
          <button ref={settingsButton} type="button" data-topic-settings aria-haspopup="dialog" aria-expanded={showSettings} aria-controls={showSettings ? `${tabId}-settings` : undefined} disabled={busy} onClick={() => setShowSettings(true)}><ContactTaskIcon name="settings" />设置</button>
      </div>
      <div className="topic-content-scroll" ref={scrollPane}>
      <header className="topic-content-header" data-topic-current={topic.id}>
        {stagesCollapsed && <button type="button" className="topic-back topic-detail-back" onClick={() => setMobileDetail(false)}>← 任务列表</button>}
        <div className="topic-title-group">{stageToggle}<h4>{topic.title}</h4></div>
      </header>
      {!activeRun && topicRun?.status === 'failed' && <p className="agent-error" role="alert">本轮执行失败：{topicRun.error || '请查看工作日志了解原因。'}</p>}
      {!activeRun && topicRun?.status === 'completed' && !data.settings.enabled && researchable(topic) && <p className="agent-caption">本轮已完成，任务尚未结束。当前未开启持续工作，可再次启动一轮，或在工作设置中开启持续工作。</p>}
      {showSettings && <ContactTaskSettingsDialog id={`${tabId}-settings`} taskTitle={topic.title} busy={busy} returnFocus={settingsButton} onClose={closeSettings}>
        <p className="agent-caption">以下调整仅针对当前任务。</p>
        {settingsError && <p className="agent-error" role="alert">{settingsError}</p>}
        <ContactTaskResources topic={topic} data={data} editable busy={busy || Boolean(editor)} onAction={settingsAction} />
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
      </ContactTaskSettingsDialog>}
      <div>
      <section role="tabpanel" id={`${tabId}-overview-panel`} aria-labelledby={`${tabId}-overview`} hidden={tab !== 'overview'} tabIndex={0}>
        <ContactTaskOverview topic={topic} data={data} visible={active && tab === 'overview' && !showSettings}>
          <ContactTaskResources topic={topic} data={data} />
          {topicRun ? renderActivity?.(topic.id) : <p className="agent-empty">任务尚未启动，执行后会在这里显示实时日志。</p>}
        </ContactTaskOverview>
      </section>
      <section role="tabpanel" id={`${tabId}-${tab === 'stages' ? 'stages' : 'delivery'}-panel`} aria-labelledby={`${tabId}-${tab === 'stages' ? 'stages' : 'delivery'}`} hidden={tab !== 'stages' && tab !== 'delivery'} tabIndex={0}>
      {tab === 'stages' && <ContactTaskResources topic={topic} data={data} />}
      <ContactDelivery key={`${characterId}:${topic.id}`} active={active && tab === 'delivery' && !showSettings} view={tab === 'stages' ? 'stages' : 'delivery'} characterId={characterId} topic={topic} busy={busy || Boolean(currentRun) || settingsDirty || Boolean(editor)} onAction={onAction} onReport={topicRun ? () => onReport(topicRun.id, topic.id) : undefined} />
      <div hidden={tab !== 'stages'}>
      <article className="topic-current">
        <p className="agent-caption">本轮执行：{currentRun?.topicId === topic.id ? AGENT_STATUS[currentRun.status] : topicRun?.status === 'failed' ? '最近一轮失败，当前未执行' : topicRun?.status === 'completed' ? '最近一轮已完成，当前未执行' : '当前未执行'}</p>
        <p className="agent-caption">{topic.status === 'paused' ? '任务已暂停，已有成果保留。' : data.settings.enabled && data.focusTopicId === topic.id && researchable(topic) ? '持续工作已开启，本轮结束后会按工作设置继续。' : '启动后执行一轮；可在工作设置中开启持续工作。'}</p>
        {topic.nextStep && <p className="topic-next-step"><strong>下一步：</strong>{topic.nextStep}</p>}
        {settingsDirty && <p className="agent-caption">工作设置尚未保存，保存后再推进事项。</p>}
        {otherRunning && <p className="agent-caption">联系人正在执行另一事项；本任务的回复会保存，待本轮结束后接续。</p>}
      </article>
      <details className="topic-goal"><summary>进展说明</summary><dl><dt>当前判断</dt><dd data-topic-judgement>{topic.judgement || '尚未形成判断。'}</dd>{topic.openQuestions && <><dt>待验证问题</dt><dd>{topic.openQuestions}</dd></>}{['completed', 'abandoned', 'paused'].includes(topic.status) && <><dt>停止原因</dt><dd>{topic.reason}</dd></>}</dl></details>
      <details className="topic-goal"><summary>目标与约束</summary><dl><dt>目标</dt><dd>{topic.goal}</dd>{topic.constraints && <><dt>约束</dt><dd>{topic.constraints}</dd></>}</dl></details>
      </div>
      </section>
      <section role="tabpanel" id={`${tabId}-interactions-panel`} aria-labelledby={`${tabId}-interactions`} hidden={tab !== 'interactions'} tabIndex={0}>
        <ContactTaskInteractions key={topic.id} characterId={characterId} topicId={topic.id} visible={tab === 'interactions' && !showSettings}
          onReply={() => { setTab('overview'); requestAnimationFrame(() => scrollPane.current?.querySelector<HTMLTextAreaElement>('.agent-question textarea')?.focus()) }} onReport={runId => onReport(runId, topic.id)} />
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
    </div>
  </section>
}
