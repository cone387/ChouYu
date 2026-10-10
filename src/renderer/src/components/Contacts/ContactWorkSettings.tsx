import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { AgentOverview, AgentSettings } from '../../../../shared/agents'
import { contactWorkStatus } from '../../../../shared/work-settings'
import './ContactWorkSettings.css'
import WorkTimePicker from './WorkTimePicker'

const amount = (n?: number) => n === undefined ? '' : String(n / 10000)
type Feedback = { error?: string; message?: string }
function Result({ feedback }: { feedback?: Feedback }) {
  return feedback?.error ? <p className="work-setting-error" role="alert">{feedback.error}</p>
    : feedback?.message ? <p className="work-setting-feedback" role="status">{feedback.message}</p> : null
}
function Field({ label, value, onApply, disabled, unit, hint, type = 'number', min, max, step = 'any', placeholder, multiline = false, feedback }: {
  label: string; value: string; onApply: (value: string) => Promise<boolean>; disabled: boolean; unit?: string; hint?: ReactNode
  type?: string; min?: number; max?: number; step?: string; placeholder?: string; multiline?: boolean; feedback?: Feedback
}) {
  const id = useId(), previous = useRef(value)
  const [text, setText] = useState(value)
  useEffect(() => {
    const before = previous.current
    setText(current => current === before ? value : current)
    previous.current = value
  }, [value])
  return <form className="work-setting-row" data-work-field={label} onSubmit={event => { event.preventDefault(); void onApply(text) }}>
    <label htmlFor={id}>{label}</label>
    <div className="work-setting-editor">
      {multiline ? <textarea id={id} data-agent-sources rows={3} placeholder={placeholder} value={text} onChange={e => setText(e.target.value)} />
        : <input id={id} disabled={disabled} data-work-call-limit={label === '每日调用保护上限' || undefined} data-agent-interval={label === '推进间隔' || undefined} aria-label={label} type={type} min={min} max={max} step={step} placeholder={placeholder} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }} />}
      {unit && <span className="work-setting-unit">{unit}</span>}
      {(text !== value || feedback?.error) && <button type="submit" disabled={disabled}>应用</button>}
    </div>
    {hint && <p className="work-setting-hint">{hint}</p>}
    <Result feedback={feedback} />
  </form>
}

function WorkHours({ value, disabled, feedback, onApply }: {
  value?: AgentSettings['workHours']; disabled: boolean; feedback?: Feedback
  onApply: (value: AgentSettings['workHours']) => Promise<boolean>
}) {
  const saved = `${value?.start ?? '00:00'}/${value?.end ?? '00:00'}`
  const previous = useRef(saved), [draft, setDraft] = useState(saved)
  useEffect(() => { const before = previous.current; setDraft(current => current === before ? saved : current); previous.current = saved }, [saved])
  const [start, end] = draft.split('/')
  return <form className="work-setting-row" data-work-hours onSubmit={e => { e.preventDefault(); void onApply(start === end ? undefined : { start, end }).then(ok => { if (ok && start === end) setDraft('00:00/00:00') }) }}>
    <span>每日工作时间</span>
    <div className="work-setting-editor work-hours-editor">
      <WorkTimePicker label="开始工作时间" disabled={disabled} value={start} onChange={time => setDraft(`${time}/${end}`)} />
      <span>至</span>
      <WorkTimePicker label="结束工作时间" disabled={disabled} value={end} onChange={time => setDraft(`${start}/${time}`)} />
      {draft !== saved && <button type="submit" disabled={disabled}>应用</button>}
    </div>
    <p className="work-setting-hint">{start === end ? '全天 24 小时' : start > end ? '跨夜工作时段' : '每日工作时段'} · 按本机时间；时段外不自动开启下一轮。</p>
    <Result feedback={feedback} />
  </form>
}

export default function ContactWorkSettings({ characterId, data, keyConfigured, busy, onSaved, onCredentialChanged }: {
  characterId: string; name?: string; data: AgentOverview; keyConfigured: boolean; busy: boolean
  onSaved: (data: AgentOverview) => void; onCredentialChanged: () => Promise<void>
}) {
  const latest = useRef(data); latest.current = data
  const lock = useRef(false), keyId = useId(), modeId = useId(), cadenceId = useId()
  const [saving, setSaving] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({})
  const [restrictedSelected, setRestrictedSelected] = useState(false)
  const [key, setKey] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setFeedback(current => Object.fromEntries(Object.entries(current).filter(([, value]) => value.error || value.message === '保存中…'))), 2500)
    return () => clearTimeout(timer)
  }, [saving])
  const settings = data.settings, disabled = busy || saving !== null
  const setResult = (field: string, value: Feedback) => setFeedback(current => ({ ...current, [field]: value }))
  const execute = async (field: string, action: () => Promise<void>, message = '已生效') => {
    if (lock.current || busy) return false
    lock.current = true; setSaving(field); setResult(field, { message: '保存中…' })
    try { await action(); setResult(field, { message }); return true }
    catch (error) {
      setResult(field, { error: error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '保存失败，请重试。' })
      try { const fresh = await window.electronAPI.agents.get(characterId); latest.current = fresh; onSaved(fresh) } catch { /* keep confirmed settings */ }
      return false
    } finally { lock.current = false; setSaving(null) }
  }
  const save = (field: string, patch: Partial<AgentSettings>, message?: string) => execute(field, async () => {
    const current = latest.current
    const result = await window.electronAPI.agents.savePreferences(characterId, {
      ...current.settings, goal: current.settings.goal || '根据用户交付的任务整理方向、研究验证并反馈进展。', ...patch
    }, current.revision)
    latest.current = result; onSaved(result)
  }, message)
  const numeric = (field: keyof AgentSettings, value: string, scale = 1) => {
    if (!value.trim() && (field === 'dailyTokenLimit' || field === 'defaultTaskTokenLimit')) return save(field, { [field]: undefined })
    const raw = Number(value) * scale, n = Math.round(raw)
    if (!value.trim() || Math.abs(raw - n) > 0.0000001 || !Number.isSafeInteger(n) || n < 1) { setResult(field, { error: '请输入有效的正整数额度。' }); return Promise.resolve(false) }
    return save(field, { [field]: n })
  }
  const toggle = (field: 'notifyProgress' | 'searchEnabled' | 'shareDeliveries' | 'readContactDeliveries', label: string, checked: boolean, unavailable = false) =>
    <div className="work-setting-row work-setting-switch-row">
      <label><span>{label}</span><input data-agent-search-enabled={field === 'searchEnabled' || undefined} type="checkbox" role="switch" checked={checked} disabled={disabled || unavailable} onChange={e => void save(field, { [field]: e.target.checked })} /></label>
      <Result feedback={feedback[field]} />
    </div>
  const showInterval = settings.paceWriting
  const restricted = settings.permissionLevel === 'sources' || restrictedSelected
  const tokens = data.tokenUsage
  return <div className="work-settings-flat" aria-label="工作设置" aria-busy={saving !== null}>
    <section className="work-setting-section" aria-label="工作方式">
      <h3>工作方式</h3>
      <div className="work-setting-choices" role="radiogroup" aria-label="工作方式">
        <label><input type="radio" name={modeId} data-work-mode="manual" checked={!settings.enabled} disabled={disabled} onChange={() => void save('mode', { enabled: false })} />按需推进</label>
        <label><input type="radio" name={modeId} data-work-mode="auto" checked={settings.enabled} disabled={disabled} onChange={() => void save('mode', { enabled: true })} />自动推进</label>
      </div>
      <div className="work-mode-status" role="status">
        {feedback.mode?.error ? <Result feedback={feedback.mode} /> : <p className="work-setting-hint">{saving === 'mode' ? '保存中…' : contactWorkStatus(data, keyConfigured)}</p>}
      </div>
      <WorkHours value={settings.workHours} disabled={disabled || !settings.enabled} feedback={feedback.workHours} onApply={value => save('workHours', { workHours: value })} />
      <Field label="最多同时推进任务数" value={String(settings.maxConcurrentTasks ?? 1)} min={1} step="1" unit="个" disabled={disabled}
        feedback={feedback.maxConcurrentTasks} onApply={value => numeric('maxConcurrentTasks', value)}
        hint="其余任务排队；等你回复或等待下次执行的任务不占名额。调低后，当前轮次仍会完成。" />


      <div className="work-setting-row"><span>推进节奏</span><div className="work-setting-choices" role="radiogroup" aria-label="推进节奏">
        <label><input type="radio" name={cadenceId} data-work-cadence="continuous" checked={!settings.paceWriting} disabled={disabled || !settings.enabled} onChange={() => void save('cadence', { paceWriting: false })} />连续推进</label>
        <label><input type="radio" name={cadenceId} data-work-cadence="interval" checked={Boolean(showInterval)} disabled={disabled || !settings.enabled} onChange={() => void save('cadence', { paceWriting: true })} />间隔推进</label>
      </div>{feedback.cadence?.error && <Result feedback={feedback.cadence} />}</div>
      <Field label="推进间隔" value={String(settings.intervalMinutes)} min={15} max={10080} step="1" unit="分钟" disabled={disabled || !settings.enabled || !showInterval}
        feedback={feedback.interval} onApply={value => save('interval', { intervalMinutes: Number(value) })} />
    </section>
    <section className="work-setting-section" aria-label="消耗上限">
      <h3>消耗上限</h3>
      <p className="work-setting-hint">Token 上限留空表示不限制。</p>
      <Field label="每日工作 Token 上限" value={amount(settings.dailyTokenLimit)} placeholder="不限制" unit="万 Token" min={0.0001} max={100000} disabled={disabled} feedback={feedback.dailyTokenLimit} onApply={value => numeric('dailyTokenLimit', value, 10000)}
        hint={tokens ? <>今日占用 {(tokens.today / 10000).toLocaleString(undefined, { maximumFractionDigits: 4 })} 万{settings.dailyTokenLimit !== undefined && `，剩余 ${(Math.max(0, settings.dailyTokenLimit - tokens.today) / 10000).toLocaleString(undefined, { maximumFractionDigits: 4 })} 万`}{tokens.estimated > 0 && '（含未返回用量的保守预留）'}</> : undefined} />
      <Field label="单任务 Token 上限" value={amount(settings.defaultTaskTokenLimit)} placeholder="不限制" unit="万 Token" min={0.0001} max={100000} disabled={disabled} feedback={feedback.defaultTaskTokenLimit} onApply={value => numeric('defaultTaskTokenLimit', value, 10000)} hint="每项新任务的累计上限；已有任务在任务描述中调整。" />
      <Field label="每日调用保护上限" value={String(settings.dailyCalls)} unit="次" min={2} step="1" disabled={disabled} feedback={feedback.dailyCalls} onApply={value => numeric('dailyCalls', value)} hint={`今日已调用 ${data.callsToday} 次；与 Token 上限同时生效。`} />
      <p className="work-setting-hint">仅后台工作，不含普通聊天。请求前预留，收到实际用量后结算；未知消耗保守估算。</p>
    </section>
    <section className="work-setting-section" aria-label="进展通知">
      <h3>进展通知</h3>{toggle('notifyProgress', '将工作进展发送到聊天', settings.notifyProgress !== false)}
    </section>
    <section className="work-setting-section" aria-label="资料与协作权限">
      <h3>资料与协作权限</h3>
      <div className="work-setting-row"><span>网页访问</span><div className="work-setting-options" role="group" aria-label="网页访问">
        <button type="button" data-work-permission="public" aria-pressed={!restricted} disabled={disabled} onClick={() => void save('permission', { permissionLevel: 'public' }).then(ok => { if (ok) setRestrictedSelected(false) })}>公开网页</button>
        <button type="button" aria-pressed={restricted} disabled={disabled} onClick={() => {
          if (settings.sources.length) void save('permission', { permissionLevel: 'sources', searchEnabled: false }).then(ok => { if (ok) setRestrictedSelected(false) })
          else setRestrictedSelected(true)
        }}>仅指定网页</button>
      </div><Result feedback={feedback.permission} /></div>
      <Field label={restricted ? '允许访问的网页' : '参考网页'} value={settings.sources.join('\n')} placeholder="https://…" multiline disabled={disabled} feedback={feedback.sources}
        hint={restricted && settings.permissionLevel !== 'sources' ? '填写网页并应用后生效，同时关闭搜索。' : '每行一个，最多 5 个。修改访问范围会停止未完成的本轮。'}
        onApply={value => save('sources', { sources: value.split('\n').map(v => v.trim()).filter(Boolean), ...(restricted ? { permissionLevel: 'sources', searchEnabled: false } : {}) }).then(ok => { if (ok) setRestrictedSelected(false); return ok })} />
      {toggle('searchEnabled', '搜索新网页', settings.searchEnabled === true, restricted || !keyConfigured)}
      {!restricted && <>
        <form className="work-setting-row" onSubmit={e => { e.preventDefault(); void execute('key', async () => { await window.electronAPI.agents.searchCredential(characterId, key); setKey(''); await onCredentialChanged() }, '密钥已保存') }}>
          <label htmlFor={keyId}>搜索密钥</label><div className="work-setting-editor"><input id={keyId} data-agent-search-key type="password" autoComplete="new-password" value={key} onChange={e => setKey(e.target.value)} placeholder={keyConfigured ? '已配置，输入可替换' : 'Brave Search API Key'} />
          {key.trim() && <button data-agent-search-key-save type="submit" disabled={disabled}>应用</button>}
          {keyConfigured && <button type="button" disabled={disabled} onClick={() => void execute('key', async () => { await window.electronAPI.agents.searchCredential(characterId, ''); await onCredentialChanged() }, '密钥已移除')}>移除</button>}</div>
          <p className="work-setting-hint">密钥修改会停止未完成的本轮。<a href="https://api-dashboard.search.brave.com/" target="_blank" rel="noopener noreferrer">获取密钥</a></p><Result feedback={feedback.key} />
        </form>
        {settings.searchEnabled && <Field label="每日搜索上限" value={String(settings.dailySearches ?? 8)} min={1} max={24} step="1" unit="次" disabled={disabled} feedback={feedback.dailySearches} onApply={value => numeric('dailySearches', value)} />}
      </>}
      {toggle('shareDeliveries', '共享自己的任务成果', settings.shareDeliveries === true)}
      {toggle('readContactDeliveries', '读取其他联系人共享的成果', settings.readContactDeliveries === true)}
      <p className="work-setting-hint">不共享私聊和独立记忆，不允许修改其他联系人的任务。</p>
    </section>

  </div>
}
