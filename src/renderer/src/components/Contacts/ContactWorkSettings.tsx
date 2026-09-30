import { useState } from 'react'
import type { AgentOverview, AgentSettings } from '../../../../shared/agents'
import { contactWorkStatus, workCadence, workSettingsRequireRestart } from '../../../../shared/work-settings'

const dateInput = (time?: number) => {
  if (!time) return ''
  const date = new Date(time)
  return new Date(time - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

export default function ContactWorkSettings({ characterId, name, data, draft, sources, keyConfigured, dirty, busy,
  setDraft, setSources, onSaved, onCredentialChanged, onTasks, onChat }: {
  characterId: string; name: string; data: AgentOverview; draft: AgentSettings; sources: string
  keyConfigured: boolean; dirty: boolean; busy: boolean
  setDraft: (settings: AgentSettings) => void; setSources: (sources: string) => void
  onSaved: (data: AgentOverview) => void; onCredentialChanged: () => Promise<void>; onTasks: () => void
  onChat?: () => void
}) {
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [key, setKey] = useState('')
  const settings = { ...draft, sources: sources.split('\n').map(url => url.trim()).filter(Boolean) }
  const disabled = busy || saving
  const restart = workSettingsRequireRestart(data.settings, settings)
  const save = async () => {
    setSaving(true); setError(''); setNotice('')
    try {
      const result = await window.electronAPI.agents.savePreferences(characterId, { ...settings, goal: settings.goal || '根据用户交付的任务整理方向、研究验证并反馈进展。' })
      onSaved(result); setNotice('工作设置已保存。')
    } catch (error) { setError(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '保存失败，请重试。') }
    finally { setSaving(false) }
  }
  const credential = async (value: string) => {
    setSaving(true); setError(''); setNotice('')
    try { await window.electronAPI.agents.searchCredential(characterId, value); setKey(''); await onCredentialChanged(); setNotice(value ? '搜索密钥已保存。' : '搜索密钥已移除。') }
    catch (error) { setError(error instanceof Error ? error.message : '搜索密钥保存失败。') }
    finally { setSaving(false) }
  }
  return <div className="agent-settings-view">
    <header className="work-settings-heading"><div><h3>{name}的工作设置</h3><p className="agent-description">对这个联系人的所有任务生效。具体任务的要求在任务描述中调整。</p></div><div className="agent-actions"><button type="button" onClick={onTasks}>查看任务</button>{onChat && <button type="button" data-agent-chat onClick={onChat}>回到聊天</button>}</div></header>
    <section className="work-settings-status" aria-label="当前生效状态">
      <strong>{data.settings.enabled ? '自动工作已开启' : '自动工作已关闭'}</strong>
      <p role="status">{contactWorkStatus(data, keyConfigured)}</p>
      <span className="agent-caption">今日共用额度：已用 {data.callsToday} / {data.settings.dailyCalls} 次模型调用。所有任务的实际调用都计入这里。</span>
    </section>
    <form className="agent-work-settings work-settings-form" onSubmit={event => { event.preventDefault(); void save() }}>
      <fieldset disabled={disabled} className="work-settings-section">
        <legend>自动工作</legend>
        <label className="agent-toggle"><input type="checkbox" data-agent-enabled checked={draft.enabled} onChange={event => setDraft({ ...draft, enabled: event.target.checked })} />本轮结束后，自动继续已安排的任务</label>
        <p className="agent-caption">应用退出或关机时暂停；重新启动会恢复中断的工作。已暂停或已结束的任务需要在任务中继续。</p>
        <div className="agent-settings-row">
          <label>资料检查间隔（分钟）<input data-agent-interval type="number" min={15} max={10080} required value={draft.intervalMinutes} onChange={event => setDraft({ ...draft, intervalMinutes: Number(event.target.value) })} /><span className="agent-caption">等待资料变化时的最短间隔；没有新内容时会延后检查。</span></label>
          <label>每日共用调用上限<input type="number" min={2} required value={draft.dailyCalls} onChange={event => setDraft({ ...draft, dailyCalls: Number(event.target.value) })} /><span className="agent-caption">所有任务共用，次日恢复。规划、执行、修订和失败重试均计入。</span></label>
        </div>
        <label>创作推进方式<select value={draft.paceWriting ? 'interval' : 'continuous'} onChange={event => setDraft({ ...draft, paceWriting: event.target.value === 'interval' })}><option value="continuous">有新正文时连续推进</option><option value="interval">每轮也按检查间隔推进</option></select><span className="agent-caption">{workCadence(draft)}。均受每日额度和任务预算限制。</span></label>
        <label>自动工作截止时间（可选）<div className="work-settings-deadline"><input type="datetime-local" aria-label="自动工作截止时间" value={dateInput(draft.workUntil)} onChange={event => setDraft({ ...draft, workUntil: event.target.value ? new Date(event.target.value).getTime() : undefined })} />{draft.workUntil && <button type="button" onClick={() => setDraft({ ...draft, workUntil: undefined })}>取消截止时间</button>}</div><span className="agent-caption">留空则长期持续；到期后自动停止，重启应用不会重新开启。</span></label>
        {draft.workUntil && draft.workUntil <= Date.now() && <p className="agent-error" role="alert">截止时间已过。要继续自动工作，请取消或延长截止时间。</p>}
      </fieldset>
      <details className="work-settings-section work-settings-disclosure">
        <summary>资料与协作权限<span>{draft.permissionLevel === 'sources' ? '仅指定网页' : '公开网页'} · {draft.readContactDeliveries ? '可读取共享成果' : '不读取其他联系人成果'}</span></summary>
        <fieldset disabled={disabled}>
          <label>网页访问范围<select data-agent-permission value={draft.permissionLevel ?? 'public'} onChange={event => setDraft({ ...draft, permissionLevel: event.target.value as 'public' | 'sources', ...(event.target.value === 'sources' ? { searchEnabled: false } : {}) })}><option value="public">可读取公开网页</option><option value="sources">仅可读取指定网页</option></select><span className="agent-caption">{draft.permissionLevel === 'sources' ? '只能读取下面列出的网页，请至少填写一个地址。' : '可根据任务选择公开网址；发现新网址的搜索服务需另外开启。'}</span></label>
          <label>参考网页（每行一个，最多 5 个）<textarea data-agent-sources rows={3} required={draft.permissionLevel === 'sources'} value={sources} onChange={event => setSources(event.target.value)} placeholder="https://…" /><span className="agent-caption">{draft.permissionLevel === 'sources' ? '这是允许访问的网页清单。' : '可留空；这些网页供所有任务优先参考。'}</span></label>
          <label className="agent-toggle"><input data-agent-search-enabled type="checkbox" disabled={draft.permissionLevel === 'sources'} checked={draft.searchEnabled === true} onChange={event => setDraft({ ...draft, searchEnabled: event.target.checked })} />使用搜索服务发现新网页</label>
          <p className="agent-caption">搜索问题会发送到 Brave Search。未开启时仍可读取权限范围内的已知网址。</p>
          {draft.searchEnabled && <><label>每日搜索次数上限<input data-agent-search-limit type="number" min={1} max={24} required value={draft.dailySearches ?? 8} onChange={event => setDraft({ ...draft, dailySearches: Number(event.target.value) })} /></label>{!keyConfigured && <p className="agent-error">尚未配置搜索密钥。先保存下方密钥，再保存开启设置。</p>}</>}
          <div className="work-settings-collaboration">
            <label className="agent-toggle"><input type="checkbox" checked={draft.shareDeliveries === true} onChange={event => setDraft({ ...draft, shareDeliveries: event.target.checked })} />把我的任务成果共享给其他联系人</label>
            <label className="agent-toggle"><input type="checkbox" checked={draft.readContactDeliveries === true} onChange={event => setDraft({ ...draft, readContactDeliveries: event.target.checked })} />允许我读取其他联系人已共享的成果</label>
            <p className="agent-caption">例如阿想共享成果，阿衡允许读取，评审任务才能取得正文。共享不包含私聊或独立记忆，也不允许替其他联系人修改任务。</p>
          </div>
        </fieldset>
        <details className="agent-search-credentials"><summary>搜索服务密钥 · {keyConfigured ? '已配置' : '未配置'}</summary>
          <p className="agent-caption">仅用于此联系人。密钥单独保存；修改会停止未完成的工作。</p>
          <label>Brave Search API Key<input data-agent-search-key type="password" autoComplete="new-password" disabled={disabled} value={key} onChange={event => setKey(event.target.value)} placeholder={keyConfigured ? '输入新密钥以替换' : '输入搜索服务密钥'} /></label>
          <div className="agent-actions"><button data-agent-search-key-save type="button" disabled={disabled || !key.trim()} onClick={() => void credential(key)}>保存搜索密钥</button>{keyConfigured && <button type="button" disabled={disabled} onClick={() => void credential('')}>移除密钥</button>}<a href="https://api-dashboard.search.brave.com/" target="_blank" rel="noopener noreferrer">申请密钥</a></div>
        </details>
      </details>
      <details className="work-settings-section work-settings-disclosure">
        <summary>进展通知<span>{draft.notifyProgress !== false ? '主动汇报进展' : '只发送待回复问题与阻塞提醒'}</span></summary>
        <fieldset disabled={disabled}><label className="agent-toggle"><input type="checkbox" checked={draft.notifyProgress !== false} onChange={event => setDraft({ ...draft, notifyProgress: event.target.checked })} />把新的工作进展发到聊天</label><p className="agent-caption">普通进展每天最多 8 条，至少间隔 30 分钟。需要你回复的问题、预算不足和成果样式修改通知仍会发送；主动消息未读时保留托盘闪烁。</p></fieldset>
      </details>
      <div className="work-settings-footer">
        <p className="agent-caption">{dirty ? restart ? '修改访问权限或关闭自动工作会停止未完成的本轮；已有成果保留。' : '额度和通知保存后生效；间隔从后续轮次使用，不打断当前工作。' : '任务目标与累计预算独立保存，提高每日上限不会增加任务预算。'}</p>
        {error && <p className="agent-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
        <div className="agent-actions"><button data-agent-save className="primary" type="submit" disabled={disabled || !dirty}>{saving ? '正在保存…' : '保存工作设置'}</button><button data-work-settings-cancel type="button" disabled={disabled || !dirty} onClick={() => { setDraft(data.settings); setSources(data.settings.sources.join('\n')); setError(''); setNotice('') }}>取消修改</button></div>
      </div>
    </form>
  </div>
}
