import ContactMaterialLink from './ContactMaterialLink'
import ContactPresentation from './ContactPresentation'
import './ContactPortfolio.css'
import ContactTaskInputForm from './ContactTaskInputForm'
import ContactMarkdown from './ContactMarkdown'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { AgentDelivery } from '../../../../shared/agent-delivery'
import type { AgentTopic } from '../../../../shared/agents'
import { deliveryText, textHash, type ContentCitation, type DeliveryRef, type ReadingPosition, type TextAnchor } from '../../../../shared/contact-content'
import { readingAt, restoreReading, selectedCitation, highlightAnchor } from './deliveryReading'
import { navigateContact } from './contactNavigation'
import ContactFiles from './ContactFiles'
import ContactRevisionDialog from './ContactRevisionDialog'
import ContactHandoffDialog from './ContactHandoffDialog'
import ContactHandoffs from './ContactHandoffs'

const stageLabel = { pending: '待开始', active: '进行中', done: '已完成' }
export default function ContactDeliveryReader({ characterId, topic, busy = false, onAction = async action => { await action() }, onReport, view = 'delivery', active = true, initialRef, initialAnchor, onNavigate, onCite }: {
  characterId: string; topic: AgentTopic; busy?: boolean
  onAction?: (action: () => Promise<unknown>) => Promise<void>
  initialRef?: DeliveryRef; initialAnchor?: TextAnchor
  onNavigate?: (ref: DeliveryRef) => void
  onCite?: (citation: ContentCitation) => void
  view?: 'stages' | 'delivery'
  active?: boolean
  onReport?: () => void
}) {
  const [artifact, setArtifact] = useState<AgentDelivery | null>(null)
  const [previous, setPrevious] = useState<AgentDelivery | null>(null)
  const [latest, setLatest] = useState(0), [loading, setLoading] = useState(true)
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [readingId, setReadingId] = useState('')
  const [revisionDialog, setRevisionDialog] = useState<{ citation: ContentCitation; scope: 'content' | 'presentation' } | null>(null)
  const [citationError, setCitationError] = useState('')
  const [handoff, setHandoff] = useState(false)
  const readerRoot = useRef<HTMLElement>(null)
  const [frameCitation, setFrameCitation] = useState<ContentCitation | null>(null)
  const cite = async (action: 'discuss' | 'content' | 'presentation') => {
    if (!artifact) return
    setCitationError('')
    try {
      if (artifact.presentation && !plain && action !== 'presentation' && frameCitation?.ref.version !== artifact.version) { setPlain(true); throw new Error('当前展示无法对应选中文字，已打开正文，请重新选择。') }
      const section = artifact.sections.find(s => s.id === readingId)
      const ref = { characterId, topicId: topic.id, version: artifact.version }
      const citation = await window.electronAPI.agents.validateCitation(characterId, action === 'presentation' || !section ? { ref } : artifact.presentation && !plain && frameCitation ? frameCitation : selectedCitation(ref, section, bodyRef.current?.querySelector('.contact-markdown') ?? null))
      if (!alive.current) return
      if (action === 'discuss') { if (onCite) onCite(citation); else await navigateContact({ kind: 'discuss', citation }) }
      else setRevisionDialog({ citation, scope: action })
    } catch (e) { if (alive.current) setCitationError(e instanceof Error ? e.message : String(e)) }
  }
  const [plain, setPlain] = useState(false)
  const [readingError, setReadingError] = useState('')
  const [resume, setResume] = useState<ReadingPosition | null>(null)
  const bodyRef = useRef<HTMLElement>(null), pendingReading = useRef<ReadingPosition | null>(null)
  const readingTimer = useRef<ReturnType<typeof setTimeout>>()
  const restoring = useRef(false), alive = useRef(true)
  const scrollToPosition = useRef<ReadingPosition | null>(null)
  const [readHashes, setReadHashes] = useState<Record<string, string>>({})
  const flushReading = () => {
    clearTimeout(readingTimer.current)
    const position = pendingReading.current
    if (!position) return
    pendingReading.current = null
    void window.electronAPI.agents.saveDeliveryReading(characterId, position).then(() => {
      if (alive.current) { setReadingError(''); if (position.anchor) setReadHashes(h => ({ ...h, [position.ref.sectionId!]: position.anchor!.textHash })) }
    }).catch(e => { if (alive.current) { pendingReading.current = position; setReadingError(`阅读位置未保存：${e instanceof Error ? e.message : '请重试'}`) } })
  }
  const recordReading = (position: ReadingPosition) => {
    pendingReading.current = position
    clearTimeout(readingTimer.current); readingTimer.current = setTimeout(flushReading, 500)
  }
  const inputs = artifact?.inputs ?? topic.initialPlan?.inputs
  const epoch = useRef(0)
  const load = async (version?: number, position?: ReadingPosition | null) => {
    flushReading()
    const request = ++epoch.current
    setLoading(true); setError(''); setNotice('')
    try {
      const value = await window.electronAPI.agents.delivery(characterId, topic.id, version)
      const before = value && value.version > 1 ? await window.electronAPI.agents.delivery(characterId, topic.id, value.version - 1) : null
      if (request !== epoch.current) return
      const restored = position && value ? restoreReading(position, value.sections) : null
      if (restored?.changed && !value?.sections.some(s => s.id === restored.sectionId)) {
        setNotice('原分节已移除，仍为你保留当前旧版。可通过版本与导出查看新版的其他内容。'); return
      }
      setArtifact(value); setPrevious(before)
      scrollToPosition.current = position && value ? { ...position, ref: { ...position.ref, version: value.version }, scrollRatio: restored?.changed ? 0 : position.scrollRatio } : null
      setReadingId(id => value?.sections.some(s => s.id === (restored?.sectionId ?? initialRef?.sectionId)) ? (restored?.sectionId ?? initialRef!.sectionId!) : value?.sections.some(section => section.id === id) ? id : value?.sections.find(section => section.runId === value.runId)?.id ?? value?.sections[0]?.id ?? '')
      if (restored?.changed) setNotice('内容已更新，已定位到原分节开头；仍可通过版本入口查看旧版。')
      if (position && !restored?.changed) setResume(position)
      if (version === undefined) setLatest(value?.version ?? 0)
    } catch (e) { if (request === epoch.current) setError(e instanceof Error ? e.message : '成果读取失败。') }
    finally { if (request === epoch.current) setLoading(false) }
  }
  useEffect(() => {
    alive.current = true; setArtifact(null); setPrevious(null); setResume(null); setPlain(Boolean(initialAnchor))
    void load(initialRef?.version)
    void window.electronAPI.agents.deliveryReading(characterId, topic.id).then(position => { if (alive.current) setResume(position) }).catch(e => { if (alive.current) setReadingError(String(e)) })
    void window.electronAPI.agents.portfolio(characterId, { topicId: topic.id }).then(page => { if (alive.current) setReadHashes(Object.fromEntries((page.items[0]?.sections ?? []).filter(s => s.readHash).map(s => [s.id, s.readHash!]))) }).catch(() => {})
    const closing = () => flushReading()
    window.addEventListener('beforeunload', closing)
    window.addEventListener('chouyu:contact-reader-flush', closing)
    return () => { flushReading(); alive.current = false; epoch.current++; window.removeEventListener('beforeunload', closing); window.removeEventListener('chouyu:contact-reader-flush', closing) }
  }, [characterId, topic.id, initialRef?.version, initialRef?.sectionId])
  useEffect(() => {
    let current = true
    void window.electronAPI.agents.delivery(characterId, topic.id).then(value => { if (current) setLatest(value?.version ?? 0) }).catch(() => {})
    return () => { current = false }
  }, [characterId, topic.id, topic.revision])
  useEffect(() => { if (!artifact && latest && !loading && !error) void load(latest) }, [latest, artifact, loading, error])
  useEffect(() => { if (!active || view !== 'delivery') flushReading() }, [active, view])
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el || !artifact) return
    restoring.current = true
    const position = scrollToPosition.current
    el.scrollTop = position?.ref.version === artifact.version && position.ref.sectionId === readingId ? position.scrollRatio * (el.scrollHeight - el.clientHeight) : 0
    if (initialAnchor && plain) {
      const section = artifact.sections.find(s => s.id === readingId), container = el.querySelector<HTMLElement>('.contact-markdown')
      if (section && container) try { highlightAnchor(container, section.body, initialAnchor) } catch (e) { setCitationError(String(e)) }
    }
    const frame = requestAnimationFrame(() => { restoring.current = false })
    return () => cancelAnimationFrame(frame)
  }, [artifact, readingId, plain, loading, initialAnchor])
  useEffect(() => {
    const restore = (event: Event) => { const location = (event as CustomEvent<import('./contactReturnLocation').ContactReturnLocation>).detail; requestAnimationFrame(() => { if (readerRoot.current?.getClientRects().length && readerRoot.current.closest<HTMLElement>('[data-contact-work-surface]')?.dataset.contactWorkSurface === location.surfaceId && location.handoff && location.delivery?.ref.characterId === characterId && location.delivery.ref.topicId === topic.id && location.delivery.ref.version === artifact?.version) setHandoff(true) }) }
    window.addEventListener('chouyu:contact-return', restore); return () => window.removeEventListener('chouyu:contact-return', restore)
  }, [characterId, topic.id, artifact?.version])
  return <section ref={readerRoot} className="contact-delivery" aria-label="阶段计划与成果" data-delivery-version={artifact?.version} data-reading-reference={artifact ? JSON.stringify({ characterId, topicId: topic.id, version: artifact.version, ...(readingId ? { sectionId: readingId } : {}) }) : undefined}>
    <div hidden={view !== 'stages'}>
      {inputs?.length ? <details className="delivery-inputs" open><summary>任务需求</summary><ContactTaskInputForm key={`${topic.id}:${artifact?.version ?? 0}:${topic.revision}`} fields={inputs} busy={busy} label="更新需求并继续" onSubmit={async reply => { await onAction(async () => { await window.electronAPI.agents.reviseTopic(characterId, topic.id, topic.revision, reply); setNotice('需求已提交，联系人会据此继续工作。') }) }} />{busy && <p className="agent-caption">有待回复的问题时，请在任务概览中补充；其他调整可在本轮结束或暂停后提交。</p>}</details> : null}
      <div className="topic-heading"><h4>阶段计划</h4>{artifact && <span className="agent-caption">版本 {artifact.version} / {latest}</span>}</div>
      {loading && <p role="status">正在读取阶段计划…</p>}
      {error && <p role="alert">{error}<button type="button" onClick={() => void load()}>重试</button></p>}
      {!loading && !error && !artifact && (topic.initialPlan ? <div data-initial-plan><p className="agent-caption">接单时的初步计划，后续会随执行更新。</p><p><strong>完成条件：</strong>{topic.initialPlan.completionCriteria}</p><ol className="delivery-stages">{topic.initialPlan.stages.map(stage => <li key={stage.id}><span>{stage.title}</span><span className="agent-caption">{stageLabel[stage.status]}</span></li>)}</ol></div> : <p className="agent-empty">正在梳理任务，阶段计划会在这里显示。</p>)}
      {artifact && !loading && <>      <div><p><strong>完成条件：</strong>{artifact.completionCriteria}</p>
      <ol className="delivery-stages">{artifact.stages.map(stage => <li key={stage.id}><span>{stage.title}</span><span className="agent-caption">{stageLabel[stage.status]}</span></li>)}</ol>
      <p className="delivery-summary">{artifact.summary}</p>
      </div>
</>}
    </div>
    <div hidden={view !== 'delivery'}>
    <div className="topic-heading"><h4>任务成果</h4>{artifact && <span className="agent-caption">已保存 {artifact.sections.length} 节 · 版本 {artifact.version} / {latest}</span>}</div>
    {loading && <p role="status">正在读取成果…</p>}
    {error && <p role="alert">{error}<button type="button" onClick={() => void load()}>重试</button></p>}
    {!loading && !error && !artifact && <div className="delivery-empty"><p>尚未保存可阅读的成果正文。</p><p className="agent-caption">进展中提到“已完成”不代表已有正文。旧任务的内容可能保存在工作报告中。</p>{onReport && <button type="button" onClick={onReport}>查看最近工作报告</button>}</div>}
    {artifact && !loading && <>
      {latest > artifact.version && <p role="status">有新版成果可读。<button type="button" data-delivery-latest onClick={() => void load(latest, resume)}>查看版本 {latest}</button></p>}
      {resume && <button type="button" data-delivery-resume onClick={() => { setPlain(true); void load(resume.ref.version, resume) }}>继续阅读 · 版本 {resume.ref.version}</button>}
      {readingError && <p role="alert">{readingError}<button type="button" onClick={flushReading}>重试保存位置</button></p>}
      {artifact.presentation && <div className="agent-actions" aria-label="成果阅读方式"><button type="button" aria-pressed={!plain} onClick={() => setPlain(false)}>{artifact.presentation.title}</button><button type="button" aria-pressed={plain} onClick={() => setPlain(true)}>正文</button></div>}
      {artifact.presentation && !plain && view === 'delivery' && active && <ContactPresentation key={`${topic.id}:${artifact.version}`} characterId={characterId} topicId={topic.id} artifact={artifact} onFallback={() => setPlain(true)} onReading={recordReading} onSelection={setFrameCitation} />}
      <div hidden={Boolean(artifact.presentation && !plain)}>
      <nav className="delivery-directory" aria-label="成果目录">{artifact.sections.map(section => <button type="button" key={section.id} aria-pressed={readingId === section.id} onClick={() => { flushReading(); scrollToPosition.current = null; setReadingId(section.id); recordReading(readingAt({ characterId, topicId: topic.id, version: artifact.version }, section, 0)); onNavigate?.({ characterId, topicId: topic.id, version: artifact.version, sectionId: section.id }) }}>{section.title}{readHashes[section.id] ? readHashes[section.id] === textHash(deliveryText(section.body)) ? ' · 已读' : ' · 已修改' : ' · 未读'}</button>)}</nav>
      {artifact.sections.filter(section => section.id === readingId).map(section => <article ref={bodyRef} className="delivery-reader delivery-reader-scroll" key={section.id} aria-label={section.title} tabIndex={0} onScroll={event => {
        if (restoring.current || !active || view !== 'delivery' || !event.isTrusted) return
        const el = event.currentTarget, ratio = el.scrollHeight > el.clientHeight ? el.scrollTop / (el.scrollHeight - el.clientHeight) : 0
        recordReading(readingAt({ characterId, topicId: topic.id, version: artifact.version }, section, Math.max(0, Math.min(1, ratio))))
      }}><h5>{section.title}</h5><ContactMarkdown>{section.body}</ContactMarkdown>{section.sources?.length ? <details><summary>本节资料来源</summary><ol>{section.sources.map((source, i) => <li key={`${source.url}:${i}`}><ContactMaterialLink href={source.url}>[{i + 1}] {source.title}</ContactMaterialLink></li>)}</ol></details> : null}</article>)}
      </div>
      <details><summary>版本与导出</summary>
      <div className="agent-actions">
        <button data-delivery-prev type="button" disabled={artifact.version <= 1} onClick={() => void load(artifact.version - 1)}>上一版</button>
        <button data-delivery-next type="button" disabled={artifact.version >= latest} onClick={() => void load(artifact.version + 1)}>下一版</button>
        <button type="button" disabled={busy} onClick={() => void onAction(async () => { if (await window.electronAPI.agents.exportDelivery(characterId, topic.id, artifact.version)) setNotice('此版本已导出。') })}>导出此版本</button>
        {artifact.presentation && <button type="button" disabled={busy} onClick={() => void onAction(async () => { if (await window.electronAPI.agents.exportDelivery(characterId, topic.id, artifact.version, 'html')) setNotice('阅读页面已导出。') })}>导出阅读页面</button>}
      </div>
      {previous && <details><summary>与上一版比较</summary>{JSON.stringify(previous.presentation) !== JSON.stringify(artifact.presentation) && <p>本版更新了阅读样式，正文变化列在下方。</p>}{JSON.stringify(previous.inputs) !== JSON.stringify(artifact.inputs) && <p>本版更新了任务需求。</p>}{artifact.sections.filter(s => { const old = previous.sections.find(p => p.id === s.id); return !old || old.body !== s.body || old.title !== s.title }).map(s => {
        const old = previous.sections.find(p => p.id === s.id)
        return <article className="delivery-diff" key={s.id}><h5>{s.title} · {old ? '已修改' : '新增'}</h5>{old && <><strong>修改前</strong><ContactMarkdown>{old.body}</ContactMarkdown></>}<strong>修改后</strong><ContactMarkdown>{s.body}</ContactMarkdown></article>
      })}<p className="agent-caption">完成条件与阶段以当前查看版本为准；未列出的分节正文保持不变。</p></details>}
      </details>
    </>}
      {artifact && <div className="agent-actions" aria-label="正文引用与修订">
      <button type="button" data-delivery-discuss onMouseDown={e => e.preventDefault()} onClick={() => void cite('discuss')}>引用讨论</button>
      <button type="button" data-delivery-revise disabled={busy} onMouseDown={e => e.preventDefault()} onClick={() => void cite('content')}>提出修改</button>
      <button type="button" data-delivery-style disabled={busy} onClick={() => void cite('presentation')}>修改阅读样式</button>
      <button type="button" data-delivery-handoff disabled={busy} onClick={() => setHandoff(true)}>交给联系人评审</button>
    </div>}
    {citationError && <p role="alert">{citationError}</p>}
    {!!artifact?.fileIds?.length && <ContactFiles owner={characterId} topicId={topic.id} fileIds={artifact.fileIds} />}
    {revisionDialog && <ContactRevisionDialog characterId={characterId} topic={topic} citation={revisionDialog.citation} scope={revisionDialog.scope} onClose={() => setRevisionDialog(null)} onSaved={() => setNotice('修改意见已保存，将沿用任务额度修订一轮。')} />}
    {artifact && handoff && <ContactHandoffDialog source={{ characterId, topicId: topic.id, version: artifact.version, ...(readingId ? { sectionId: readingId } : {}) }} title={topic.title} onClose={() => setHandoff(false)} onSaved={() => setNotice('评审任务已保存，接收者会按原权限和额度执行。')} />}
    {artifact && <ContactHandoffs owner={characterId} topicId={topic.id} getCitation={async () => {
      if (artifact.presentation && !plain) {
        if (frameCitation?.ref.version === artifact.version) return window.electronAPI.agents.validateCitation(characterId, frameCitation)
        setPlain(true); throw new Error('当前展示无法对应选中文字，已打开正文，请重新选择。')
      }
      const section = artifact.sections.find(s => s.id === readingId), ref = { characterId, topicId: topic.id, version: artifact.version }
      return window.electronAPI.agents.validateCitation(characterId, section ? selectedCitation(ref, section, bodyRef.current?.querySelector('.contact-markdown') ?? null) : { ref })
    }} />}
    {notice && <p role="status">{notice}</p>}
    </div>
    {view === 'stages' && notice && <p role="status">{notice}</p>}
  </section>
}
