import { useEffect, useId, useRef, useState } from 'react'
import type { ContactTaskInteraction } from '../../../../shared/contact-interactions'
import type { AgentOverview } from '../../../../shared/agents'
import type { ContactProfileSnapshot } from '../../../../shared/contact-profile-settings'
import type { ToolCatalogItem } from '../../../../shared/tools'
import ContactWorkSettings from '../Contacts/ContactWorkSettings'
import ContactSkills from '../Contacts/ContactSkills'

function WorkRemedy({ owner }: { owner: string }) {
  const [data, setData] = useState<AgentOverview>(), [configured, setConfigured] = useState(false), [error, setError] = useState('')
  const credential = async () => setConfigured((await window.electronAPI.agents.searchCredential(owner)).configured)
  useEffect(() => {
    let current = true
    void Promise.all([window.electronAPI.agents.get(owner), window.electronAPI.agents.searchCredential(owner)]).then(([data, configured]) => { if (current) { setData(data); setConfigured(configured.configured) } }).catch(e => { if (current) setError(String(e)) })
    return () => { current = false }
  }, [owner])
  return <>{error && <p role="alert">{error}</p>}{data ? <ContactWorkSettings characterId={owner} data={data} keyConfigured={configured} busy={false} onSaved={setData} onCredentialChanged={credential} permissionsOnly /> : !error && <p role="status">正在读取权限配置…</p>}</>
}

function ToolRemedy() {
  const [tools, setTools] = useState<ToolCatalogItem[]>([]), [selected, setSelected] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  useEffect(() => { let current = true; void window.electronAPI.tools.list().then(value => { if (current) setTools(value) }).catch(e => { if (current) setMessage(String(e)) }); return () => { current = false } }, [])
  const tool = tools.find(tool => tool.name === selected)
  return <div>
    <p>按诊断选择需要的工具。工具开关对所有联系人生效；启用不等于执行，原确认策略和权限仍然有效。</p>
    <label className="contact-interaction-field">需要启用的工具<select value={selected} disabled={busy} onChange={e => setSelected(e.target.value)}><option value="">请选择实际工具</option>{tools.filter(tool => !tool.enabled).map(tool => <option key={tool.name} value={tool.name}>{tool.displayName}</option>)}</select></label>
    {tool && <p>{tool.description}</p>}
    <button type="button" disabled={!tool || busy || tool.enabled} onClick={() => { setBusy(true); void window.electronAPI.tools.setEnabled(selected, true).then(value => { setTools(value); setMessage('工具已启用。请点击原卡片重试任务。') }).catch(e => setMessage(String(e))).finally(() => setBusy(false)) }}>启用所选工具</button>
    {message && <p role="status">{message}</p>}
  </div>
}

function ModelRemedy({ owner }: { owner: string }) {
  const [profile, setProfile] = useState<ContactProfileSnapshot>(), [provider, setProvider] = useState(''), [model, setModel] = useState('')
  const [models, setModels] = useState<string[]>([]), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const pending = useRef(false), listId = useId()
  useEffect(() => {
    let current = true
    void window.electronAPI.agents.profile(owner).then(value => { if (current) { setProfile(value); setProvider(value.profile.providerProfileId); setModel(value.profile.model) } }).catch(e => { if (current) setError(String(e)) })
    return () => { current = false }
  }, [owner])
  const save = async () => {
    if (!profile || pending.current) return
    pending.current = true; setBusy(true); setError(''); setNotice('')
    try {
      await window.electronAPI.characters.update(owner, { ...profile.profile, providerProfileId: provider, model, revision: profile.revision })
      setProfile(await window.electronAPI.agents.profile(owner)); setNotice('模型选择已保存。请点击原卡片重试任务；配置保存不代表模型服务已经恢复。')
    } catch (e) { setError(String(e)) }
    finally { pending.current = false; setBusy(false) }
  }
  return <div className="contact-model-remedy">
    {profile && <>
      <label className="contact-interaction-field">供应商档案<select aria-label="故障处理供应商" value={provider} disabled={busy || profile.builtIn} onChange={e => { setProvider(e.target.value); setModels([]) }}>{profile.providers.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
      <label className="contact-interaction-field">模型<input aria-label="故障处理模型" value={model} maxLength={256} list={listId} disabled={busy} onChange={e => setModel(e.target.value)} placeholder="填写模型名称" /><datalist id={listId}>{models.map(value => <option value={value} key={value} />)}</datalist></label>
      {profile.builtIn && <p>此处会修改系统默认模型，跟随默认模型的联系人也会使用它。</p>}
      <div className="contact-interaction-actions"><button type="button" disabled={busy} onClick={() => { setBusy(true); void window.electronAPI.characters.fetchModels(provider).then(result => { setModels(result.models); if (!result.ok) setError(result.message) }).catch(e => setError(String(e))).finally(() => setBusy(false)) }}>获取模型</button><button type="button" data-remedy-save-model disabled={busy} onClick={() => void save()}>保存模型选择</button></div>
    </>}
    {!profile && !error && <p role="status">正在读取模型配置…</p>}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
  </div>
}

/** The original failure remains unresolved until the user explicitly retries it. */
export default function ContactFailureRemedy({ view }: { view: ContactTaskInteraction }) {
  const [open, setOpen] = useState(false)
  const target = view.failure?.settingsTarget === 'work' ? 'work' : view.failure?.settingsTarget === 'skills' ? 'skills' : ['billing', 'configuration'].includes(view.failure?.kind ?? '') ? 'model' : view.failure?.kind === 'permission' ? 'tools' : undefined
  if (!target) return null
  return <details data-contact-remedy onToggle={e => setOpen(e.currentTarget.open)}><summary data-remedy-control>{target === 'work' ? '直接调整权限与搜索' : target === 'skills' ? '直接处理技能与运行环境' : target === 'tools' ? '直接启用所需工具' : '直接更换模型'}</summary>
    {open && (target === 'work' ? <WorkRemedy owner={view.characterId} /> : target === 'skills' ? <ContactSkills characterId={view.characterId} name={view.characterName || '此联系人'} initialView="library" /> : target === 'tools' ? <ToolRemedy /> : <ModelRemedy owner={view.characterId} />)}
  </details>
}
