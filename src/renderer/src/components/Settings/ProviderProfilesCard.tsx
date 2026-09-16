import { useCallback, useEffect, useState } from 'react'
import type { ResolvedProviderProfile } from '../../../../shared/config'
import { MAX_PROVIDER_PROFILES } from '../../../../shared/config'

interface ProfileDraft {
  id: string
  name: string
  provider: 'openai' | 'claude'
  baseUrl: string
  apiKey: string
}

const EMPTY: Omit<ProfileDraft, 'id'> = { name: '', provider: 'openai', baseUrl: '', apiKey: '' }

export default function ProviderProfilesCard() {
  const [profiles, setProfiles] = useState<ResolvedProviderProfile[]>([])
  const [draft, setDraft] = useState<ProfileDraft | null>(null)
  const [error, setError] = useState('')

  const refresh = useCallback(() => {
    void window.electronAPI.providerProfiles.list().then(setProfiles).catch(() => {})
  }, [])
  useEffect(refresh, [refresh])

  const save = useCallback(async () => {
    if (!draft) return
    try {
      setProfiles(await window.electronAPI.providerProfiles.save(draft))
      setDraft(null)
      setError('')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存失败，请重试。')
    }
  }, [draft])

  const remove = useCallback(async (id: string) => {
    try {
      setProfiles(await window.electronAPI.providerProfiles.remove(id))
      setError('')
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除失败，请重试。')
    }
  }, [])

  const customCount = profiles.filter((profile) => !profile.builtIn).length
  const atCapacity = customCount >= MAX_PROVIDER_PROFILES

  return (
    <section className="settings-card provider-profiles-card" aria-label="供应商档案">
      <h3>供应商档案</h3>
      <p className="settings-hint">角色可选用不同的档案；「默认」档案即上方的 AI 配置。</p>
      <ul>
        {profiles.map((profile) => (
          <li key={profile.id}>
            <strong>{profile.name}</strong>
            <span> {profile.provider === 'claude' ? 'Claude' : 'OpenAI 兼容'} · {profile.baseUrl}</span>
            {!profile.builtIn && (
              <>
                <button type="button" onClick={() => setDraft({ id: profile.id, name: profile.name, provider: profile.provider, baseUrl: profile.baseUrl, apiKey: profile.apiKey })}>编辑</button>
                <button type="button" className="danger" onClick={() => { void remove(profile.id) }}>删除</button>
              </>
            )}
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="settings-error">{error}</p>}
      {draft ? (
        <div className="provider-profile-form">
          <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="档案名称" maxLength={64} />
          <select value={draft.provider} onChange={(event) => setDraft({ ...draft, provider: event.target.value as 'openai' | 'claude' })}>
            <option value="openai">OpenAI 兼容</option>
            <option value="claude">Claude</option>
          </select>
          <input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="Base URL" />
          <input type="password" value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder="API Key" />
          <div>
            <button type="button" onClick={() => setDraft(null)}>取消</button>
            <button type="button" onClick={() => { void save() }} disabled={!draft.name.trim() || !draft.baseUrl.trim()}>保存</button>
          </div>
        </div>
      ) : (
        <>
          {atCapacity && <p className="settings-hint">最多支持 {MAX_PROVIDER_PROFILES} 个自定义档案。</p>}
          <button type="button" onClick={() => setDraft({ ...EMPTY, id: `p-${Date.now()}` })} disabled={atCapacity}>新建档案</button>
        </>
      )}
    </section>
  )
}
