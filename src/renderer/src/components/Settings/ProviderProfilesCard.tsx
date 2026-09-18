import { useCallback, useEffect, useRef, useState } from 'react'
import type { ResolvedProviderProfile } from '../../../../shared/config'
import { MAX_PROVIDER_PROFILES } from '../../../../shared/config'
import { useConfirm } from '../common/ConfirmProvider'

interface ProfileDraft { id: string; name: string; provider: 'openai' | 'claude'; baseUrl: string; apiKey: string }
const EMPTY: Omit<ProfileDraft, 'id'> = { name: '', provider: 'openai', baseUrl: '', apiKey: '' }

export default function ProviderProfilesCard() {
  const confirm = useConfirm()
  const [profiles, setProfiles] = useState<ResolvedProviderProfile[]>([])
  const [draft, setDraft] = useState<ProfileDraft | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const inFlight = useRef(false)
  const loadSequence = useRef(0)

  const refresh = useCallback(async () => {
    const sequence = ++loadSequence.current
    setLoading(true); setError('')
    try {
      const result = await window.electronAPI.providerProfiles.list()
      if (sequence !== loadSequence.current) return
      setProfiles(result); setLoadFailed(false)
    } catch (reason) {
      if (sequence !== loadSequence.current) return
      setLoadFailed(true); setError(reason instanceof Error ? reason.message : '档案加载失败，请重试。')
    } finally { if (sequence === loadSequence.current) setLoading(false) }
  }, [])
  useEffect(() => { void refresh(); return () => { loadSequence.current++ } }, [refresh])

  const save = async () => {
    if (!draft || inFlight.current) return
    inFlight.current = true; setBusy(true); setError(''); setNotice('')
    try {
      setProfiles(await window.electronAPI.providerProfiles.save({ ...draft, name: draft.name.trim(), baseUrl: draft.baseUrl.trim() }))
      setDraft(null); setNotice('档案已保存。')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败，请重试。') }
    finally { inFlight.current = false; setBusy(false) }
  }
  const remove = async (profile: ResolvedProviderProfile) => {
    if (inFlight.current || !await confirm({ title: '删除供应商档案', message: `删除「${profile.name}」？此操作无法撤销；被角色使用的档案需要先解除关联。` })) return
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError(''); setNotice('')
    try { setProfiles(await window.electronAPI.providerProfiles.remove(profile.id)); setNotice('档案已删除。') }
    catch (reason) { setError(reason instanceof Error ? reason.message : '删除失败，请重试。') }
    finally { inFlight.current = false; setBusy(false) }
  }
  const atCapacity = profiles.filter(profile => !profile.builtIn).length >= MAX_PROVIDER_PROFILES
  const unavailable = busy || loading || loadFailed
  return <section className="settings-card provider-profiles-card" aria-label="供应商档案" aria-busy={busy || loading}>
    <h3>供应商档案</h3>
    <p className="settings-hint">角色可选用不同的档案；「默认」档案即上方的 AI 配置。</p>
    {loading && <p role="status">正在加载档案…</p>}
    {busy && <p role="status">正在保存修改…</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className="settings-error">{error}{loadFailed && <button type="button" className="app-button" disabled={loading} onClick={() => void refresh()}>重试加载</button>}</p>}
    <ul>{profiles.map(profile => <li key={profile.id}>
      <strong>{profile.name}</strong><span>{profile.provider === 'claude' ? 'Claude' : 'OpenAI 兼容'} · {profile.baseUrl}</span>
      {!profile.builtIn && <div className="provider-profile-actions">
        <button type="button" className="app-button" disabled={unavailable || draft !== null} onClick={() => { setError(''); setNotice(''); setDraft({ id: profile.id, name: profile.name, provider: profile.provider, baseUrl: profile.baseUrl, apiKey: profile.apiKey }) }}>编辑</button>
        <button type="button" className="app-button app-button-danger" disabled={unavailable || draft !== null} onClick={() => void remove(profile)}>删除</button>
      </div>}
    </li>)}</ul>
    {draft ? <form className="provider-profile-form" onSubmit={event => { event.preventDefault(); void save() }}>
      <label>档案名称<input aria-label="档案名称" disabled={busy} required value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="档案名称" maxLength={64} /></label>
      <label>服务类型<select aria-label="档案服务类型" disabled={busy} value={draft.provider} onChange={event => setDraft({ ...draft, provider: event.target.value as 'openai' | 'claude' })}><option value="openai">OpenAI 兼容</option><option value="claude">Claude</option></select></label>
      <label>Base URL<input aria-label="档案 Base URL" disabled={busy} required value={draft.baseUrl} onChange={event => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="https://api.openai.com/v1" /></label>
      <label>API Key<input aria-label="档案 API Key" type="password" disabled={busy} value={draft.apiKey} onChange={event => setDraft({ ...draft, apiKey: event.target.value })} autoComplete="off" placeholder="API Key" /></label>
      <div><button type="button" className="app-button" disabled={busy} onClick={() => { setDraft(null); setError('') }}>取消</button><button type="submit" className="app-button app-button-primary" disabled={busy || !draft.name.trim() || !draft.baseUrl.trim()}>{busy ? '保存中…' : '保存'}</button></div>
    </form> : <>{atCapacity && <p className="settings-hint">最多支持 {MAX_PROVIDER_PROFILES} 个自定义档案。</p>}<button type="button" className="app-button app-button-primary" onClick={() => { setError(''); setNotice(''); setDraft({ ...EMPTY, id: `p-${crypto.randomUUID()}` }) }} disabled={unavailable || atCapacity}>新建档案</button></>}
  </section>
}
