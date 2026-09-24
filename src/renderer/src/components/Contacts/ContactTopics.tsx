import { useEffect, useRef, useState } from 'react'
import { TOPIC_STATUS, type AgentOverview, type AgentTopic, type AgentTopicDetail, type AgentTopicInput, type AgentTopicStatus } from '../../../../shared/agents'
import './ContactTopics.css'
import type { AgentFocusRequest } from '../../../../shared/agents'

type Editor = { kind: 'edit' | 'status'; topicId: string; revision: number; input: AgentTopicInput; status: AgentTopicStatus; reason: string }
const researchable = (topic: AgentTopic) => ['planned', 'researching', 'needs_evidence'].includes(topic.status)
const time = (value: number) => new Date(value).toLocaleString()

export default function ContactTopics({ characterId, data, busy, settingsDirty, onAction, onReport, focusRequest }: {
  characterId: string; data: AgentOverview; busy: boolean; settingsDirty: boolean
  onAction: (action: () => Promise<unknown>) => Promise<void>; onReport: (runId: string, topicId: string) => void
  focusRequest?: AgentFocusRequest
}) {
  const [selected, setSelected] = useState(data.focusTopicId ?? data.topics[0]?.id ?? '')
  useEffect(() => { if (focusRequest) setSelected(focusRequest.topicId) }, [focusRequest])
  const [detail, setDetail] = useState<AgentTopicDetail | null>(null)
  const [loading, setLoading] = useState(false), [error, setError] = useState('')
  const [editor, setEditor] = useState<Editor | null>(null)
  // A task assigned from chat becomes the current selection; keep an open edit intact.
  useEffect(() => { if (!editor && data.focusTopicId) setSelected(data.focusTopicId) }, [data.focusTopicId])
  const epoch = useRef(0)
  const topic = data.topics.find(item => item.id === selected)
  const currentRun = data.runs.find(run => ['queued', 'running', 'waiting', 'interrupted'].includes(run.status))
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
    <div className="topic-heading"><h4>持续推进的事项</h4></div>
    <p className="agent-caption">每轮接着当前事项推进。暂停或结束后不会自动换题；其他事项可单独运行，或设为当前事项。</p>
    {!data.topics.length && <p className="agent-empty">在聊天里直接交代任务，这里会显示进度和每一轮的判断。</p>}
    {data.topics.length > 0 && <label className="topic-picker">查看事项<select data-topic-select value={selected} disabled={busy || Boolean(editor)} onChange={event => setSelected(event.target.value)}>
      {data.topics.map(item => <option key={item.id} value={item.id}>{item.id === data.focusTopicId ? '当前 · ' : ''}{item.title} · {TOPIC_STATUS[item.status]}</option>)}
    </select></label>}
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
    {topic && <>
      <article className="topic-current" data-topic-current={topic.id}>
        <div className="topic-heading"><h4>{topic.title}</h4><span className="topic-status">{currentRun?.topicId === topic.id && currentRun.status === 'waiting' ? '等你回复' : TOPIC_STATUS[topic.status]}</span></div>
        <dl><dt>目标</dt><dd>{topic.goal}</dd>{topic.constraints && <><dt>约束</dt><dd>{topic.constraints}</dd></>}
          <dt>当前判断</dt><dd data-topic-judgement>{topic.judgement || '尚未开始研究，还没有形成判断。'}</dd>
          <dt>待验证问题</dt><dd>{topic.openQuestions || '尚未记录'}</dd>
          <dt>下一步</dt><dd>{topic.nextStep || (researchable(topic) ? '正在整理任务方向。' : '已停止推进。')}</dd>
          {['completed', 'abandoned', 'paused'].includes(topic.status) && <><dt>停止原因</dt><dd>{topic.reason}</dd></>}
        </dl>
        <div className="agent-actions">
          <button type="button" data-topic-run disabled={busy || settingsDirty || Boolean(editor) || Boolean(currentRun) || !researchable(topic)} onClick={() => void onAction(() => window.electronAPI.agents.run(characterId, topic.id))}>推进一轮</button>
          {data.focusTopicId !== topic.id && researchable(topic) && <button type="button" disabled={busy || Boolean(editor)} onClick={() => void onAction(() => window.electronAPI.agents.focusTopic(characterId, topic.id))}>设为当前事项</button>}
          <button type="button" disabled={busy || Boolean(editor)} onClick={() => edit('edit')}>编辑事项</button>
          <button type="button" data-topic-pause disabled={busy || Boolean(editor)} onClick={() => edit('status', researchable(topic) ? 'paused' : 'planned')}>{researchable(topic) ? '暂停事项' : '继续事项'}</button>
          {researchable(topic) && <><button type="button" disabled={busy || Boolean(editor)} onClick={() => edit('status', 'completed')}>结束事项</button><button type="button" disabled={busy || Boolean(editor)} onClick={() => edit('status', 'abandoned')}>放弃事项</button></>}
        </div>
        {settingsDirty && <p className="agent-caption">工作设置尚未保存，保存后再推进事项。</p>}
        {currentRun && currentRun.topicId !== topic.id && <p className="agent-caption">联系人正在处理另一事项，完成后可推进这一项。</p>}
      </article>
      <div className="topic-timeline"><h4>判断如何变化</h4>
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
    </>}
  </section>
}
