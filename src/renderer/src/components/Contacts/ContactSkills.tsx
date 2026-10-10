import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ContactSkill, SkillAction, SkillHubStatus, SkillListing, SkillSearchResult } from '../../../../shared/skills'
import './ContactSkills.css'
import SkillMarket from './SkillMarket'
import SkillRuntimeDialog from './SkillRuntimeDialog'

const message = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '操作失败，请重试。'
type Detail = { item: SkillSearchResult | ContactSkill; mode: 'view' | 'install' | 'uninstall' }

function SkillDialog({ detail, busy, error, onClose, onSubmit, onCancelOperation }: { detail: Detail; busy: boolean; error: string; onClose: () => void; onSubmit: () => void; onCancelOperation: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), title = useId()
  const [content, setContent] = useState(''), [readError, setReadError] = useState('')
  const [loading, setLoading] = useState(detail.mode === 'view')
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null, element = dialog.current
    element?.showModal()
    return () => { element?.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  useEffect(() => {
    let alive = true
    if (detail.mode === 'view') void window.electronAPI.skills.detail(detail.item.id).then(result => { if (alive) setContent(result.content) }).catch(error => { if (alive) setReadError(message(error)) }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [detail.item.id, detail.mode])
  const installed = 'digest' in detail.item ? detail.item : undefined
  return createPortal(<dialog ref={dialog} data-skill-dialog data-interactive data-interactive-bounds className="contact-task-dialog contact-skill-dialog" aria-labelledby={title}
    onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation() }}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); if (busy) onCancelOperation(); else onClose() }}>
    <form onSubmit={event => { event.preventDefault(); if (!busy) onSubmit() }}>
      <h3 id={title}>{detail.mode === 'install' ? '安装技能' : detail.mode === 'uninstall' ? '卸载技能' : '技能详情'} · {detail.item.name}</h3>
      <p className="agent-caption">来源：{'source' in detail.item && detail.item.source === 'clawhub' ? 'ClawHub（经 SkillHub）' : 'SkillHub'} · {detail.item.version || '未提供版本'}</p>
      <p>{detail.item.description || '商店未提供说明。'}</p>
      {detail.mode === 'install' && <p className="agent-caption">安装后可为当前联系人启用说明。首次安装会自动准备 SkillHub 商店组件；脚本、依赖和外部能力分别检查，在“能力与运行”中配置。</p>}
      {detail.mode === 'uninstall' && <p>将从本应用的技能库删除文件。此技能当前没有联系人关联。</p>}
      {installed?.unavailableReason && <p className="skill-unavailable">{installed.unavailableReason}</p>}
      {loading && <p role="status">正在读取技能正文…</p>}
      {content && <pre className="skill-content" tabIndex={0}>{content}</pre>}
      {(error || readError) && <p role="alert" className="agent-error">{error || readError}</p>}
      <footer>
        <button type="button" onClick={() => busy ? onCancelOperation() : onClose()}>{busy ? '取消操作' : detail.mode === 'view' ? '关闭' : '取消'}</button>
        {detail.mode !== 'view' && <button type="submit" data-skill-confirm className={detail.mode === 'uninstall' ? 'danger' : 'primary'} disabled={busy}>{busy ? '处理中…' : detail.mode === 'install' ? '安装' : '卸载'}</button>}
      </footer>
    </form>
  </dialog>, document.body)
}

export default function ContactSkills({ characterId, name }: { characterId: string; name: string }) {
  const [listing, setListing] = useState<SkillListing>(), [status, setStatus] = useState<SkillHubStatus>()
  const [view, setView] = useState<'library' | 'market'>('market')
  const [marketRefresh, setMarketRefresh] = useState(0)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [detail, setDetail] = useState<Detail>()
  const [runtimeSkillId, setRuntimeSkillId] = useState<string>()
  const mounted = useRef(false), pending = useRef(false), cancelled = useRef(false)
  const cancelOperation = () => { cancelled.current = true; void window.electronAPI.skills.cancel() }
  useEffect(() => {
    mounted.current = true
    void Promise.all([window.electronAPI.skills.list(characterId), window.electronAPI.skills.status()]).then(([data, state]) => {
      if (mounted.current) { setListing(data); setStatus(state) }
    }).catch(error => { if (mounted.current) setError(message(error)) })
    return () => { mounted.current = false; if (pending.current) cancelOperation() }
  }, [characterId])
  const perform = async (action: () => Promise<void>) => {
    if (pending.current) return
    pending.current = true; cancelled.current = false; setBusy(true); setError(''); setNotice('')
    try { await action() } catch (error) { if (mounted.current) setError(message(error)) }
    finally { pending.current = false; if (mounted.current) setBusy(false) }
  }
  const refresh = async () => { const next = await window.electronAPI.skills.list(characterId); if (mounted.current) setListing(next) }
  const configure = (skill: ContactSkill, action: SkillAction) => void perform(async () => {
    const next = await window.electronAPI.skills.configure(characterId, skill.id, action, listing!.revision)
    if (mounted.current) { setListing(next); setNotice(action === 'enable' ? `已为${name}启用「${skill.name}」。` : action === 'disable' ? `已停用「${skill.name}」。` : `已移除「${skill.name}」的联系人关联。`) }
  })
  const submitDialog = () => void perform(async () => {
    if (!detail || detail.mode === 'view') return
    if (detail.mode === 'install') {
      if (!status?.ready) {
        const ready = await window.electronAPI.skills.setup()
        if (!mounted.current) return
        if (cancelled.current) throw new Error('操作已取消。')
        if (mounted.current) setStatus(ready)
      }
      const skill = await window.electronAPI.skills.install(detail.item.id)
      if (mounted.current) setNotice(skill.unavailableReason ? `已安装「${skill.name}」。${skill.unavailableReason}` : `已安装「${skill.name}」，可在技能库为${name}启用。`)
    } else await window.electronAPI.skills.uninstall(detail.item.id)
    await refresh()
    if (mounted.current) { setDetail(undefined); setView('library') }
  })
  const ordered = [...(listing?.skills ?? [])].sort((a, b) => Number(b.assigned) - Number(a.assigned) || b.installedAt - a.installedAt)
  const groups = [{ title: '已启用', skills: ordered.filter(skill => skill.enabled) }, { title: '其他已安装', skills: ordered.filter(skill => !skill.enabled) }]
  return <section className="contact-skills" aria-label={`${name}的技能`} data-contact-skills data-view={view}>
    <div className="skill-heading"><div><h3>{view === 'market' ? '发现技能' : '技能库'}</h3><p className="agent-caption">{view === 'market' ? `从 SkillHub 为${name}挑选技能。` : '下次聊天或新工作轮次生效。'}</p></div>
      <button type="button" disabled={busy} onClick={() => { if (view === 'market') setMarketRefresh(value => value + 1); void perform(refresh) }}>刷新</button></div>
    <div className="skill-switch" aria-label="技能内容">
      <button type="button" data-skill-market aria-pressed={view === 'market'} onClick={() => setView('market')}>技能市场</button>
      <button type="button" data-skill-library aria-pressed={view === 'library'} onClick={() => setView('library')}>技能库{listing ? ` · ${listing.skills.filter(skill => skill.enabled).length} 项已启用` : ''}</button>
    </div>
    {!detail && error && <p role="alert" className="agent-error">{error}</p>}
    {notice && <p role="status" className="skill-notice">{notice}</p>}
    {view === 'library' ? <>
      <p className="agent-caption">为{name}选择技能。启用状态独立，已安装的技能可供其他联系人使用。</p>
      {!listing && !error && <p role="status">正在读取技能库…</p>}
      {listing && !listing.skills.length && <div className="skill-empty"><strong>还没有安装技能</strong><p>从技能市场找到合适的方法，再配置给{name}。</p><button type="button" onClick={() => setView('market')}>浏览技能市场</button></div>}
      {groups.filter(group => group.skills.length).map(group => <section className="skill-library-group" key={group.title} aria-label={group.title}>
      <div className="skill-group-heading"><h4>{group.title}</h4><span>{group.skills.length}</span></div>
      <ul className="skill-list">{group.skills.map(skill => <li key={skill.id} data-skill-id={skill.id} data-enabled={skill.enabled}>
        <div className="skill-card-heading">
          <span className="skill-library-icon" aria-hidden="true">{Array.from(skill.name)[0]}</span>
          <div className="skill-card-identity"><h4>{skill.name}</h4><span>SkillHub · {skill.version || '版本未提供'}</span></div>
          <button type="button" className="skill-card-toggle" data-skill-toggle aria-label={`${skill.enabled ? '停用' : '启用'}${skill.name}`} disabled={busy || Boolean(!skill.enabled && skill.unavailableReason)} onClick={() => configure(skill, skill.enabled ? 'disable' : 'enable')}>{skill.enabled ? '停用' : `为${name}启用`}</button>
        </div>
        <p className="skill-card-description" title={skill.description}>{skill.description || '未提供简介，可查看技能正文。'}</p>
        <div className="skill-card-status"><span data-active={skill.enabled}>{skill.enabled ? '说明已启用' : skill.assigned ? '已停用' : '未配置'}</span><span>{skill.compatibility?.scripts.length ? skill.scriptsEnabled ? '脚本已授权' : `${skill.compatibility.scripts.length} 个脚本 · 未授权` : '无需脚本'}</span></div>
        {skill.unavailableReason && <p className="skill-unavailable">{skill.unavailableReason}</p>}
        <div className="skill-actions">
          <button type="button" disabled={busy} onClick={() => { setError(''); setDetail({ item: skill, mode: 'view' }) }}>查看正文</button>
          <button type="button" data-skill-runtime disabled={busy} onClick={() => setRuntimeSkillId(skill.id)}>能力与运行</button>
        </div>
        <details className="skill-card-more"><summary>更多<span>{skill.usedBy.length ? `${skill.usedBy.length} 位联系人使用` : '尚未关联联系人'}</span></summary>
          <div className="skill-actions">
            {skill.assigned && <button type="button" data-skill-remove disabled={busy} onClick={() => configure(skill, 'remove')}>移除关联</button>}
            {!skill.usedBy.length && <button type="button" disabled={busy} onClick={() => { setError(''); setDetail({ item: skill, mode: 'uninstall' }) }}>卸载</button>}
          </div>
          {!!skill.usedBy.length && <p className="agent-caption">全部移除关联后可卸载。</p>}
        </details>
      </li>)}</ul></section>)}
    </> : null}
    <div hidden={view !== 'market'}><SkillMarket installed={new Set(listing?.skills.map(skill => skill.id))} busy={busy} refreshKey={marketRefresh} onSelect={skill => { setError(''); setDetail({ item: skill, mode: listing?.skills.some(item => item.id === skill.id) ? 'view' : 'install' }) }} /></div>
    {detail && <SkillDialog key={`${detail.item.id}:${detail.mode}`} detail={detail} error={error} busy={busy} onClose={() => { setDetail(undefined); setError('') }} onSubmit={submitDialog} onCancelOperation={cancelOperation} />}
    {runtimeSkillId && listing?.skills.find(skill => skill.id === runtimeSkillId) && <SkillRuntimeDialog characterId={characterId} skill={listing.skills.find(skill => skill.id === runtimeSkillId)!} revision={listing.revision} onChange={setListing} onClose={() => setRuntimeSkillId(undefined)} />}
  </section>
}
