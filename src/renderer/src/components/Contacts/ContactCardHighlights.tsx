import { useState } from 'react'
import type { ContactCardHighlights as Highlights } from '../../../../shared/contact-home'
import { navigateContact, type ContactNavigation } from './contactNavigation'
import './ContactHome.css'

export default function ContactCardHighlights({ characterId, highlights }: { characterId: string; highlights?: Highlights }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  if (!highlights || !['pending', 'delivery', 'task'].some(key => highlights[key as keyof Highlights])) return null
  const open = async (target: ContactNavigation) => {
    setError(''); setBusy(true)
    try { await navigateContact(target) }
    catch (e) { setError(e instanceof Error ? e.message : '无法打开来源，请重新读取后再试。') }
    finally { setBusy(false) }
  }
  const pending = highlights.sources?.pending, delivery = highlights.sources?.delivery
  return <div className="contacts-card-highlights">
    {highlights.pending && (pending ? <button type="button" disabled={busy} data-contact-card-pending={characterId} onClick={event => { event.stopPropagation(); void open({ kind: 'interaction', ...pending }) }}><strong>等你回应</strong>{highlights.pending}</button> : <span><strong>等你回应</strong>{highlights.pending}</span>)}
    {highlights.delivery && (delivery ? <button type="button" disabled={busy} data-contact-card-delivery={characterId} data-contact-source-version={delivery.version} onClick={event => { event.stopPropagation(); void open({ kind: 'delivery', ref: delivery }) }}><strong>最近交付</strong>{highlights.delivery}</button> : <span><strong>最近交付</strong>{highlights.delivery}</span>)}
    {highlights.task && <span><strong>正在推进</strong>{highlights.task}</span>}
    {error && <p className="contacts-card-source-error" role="alert">{error}</p>}
  </div>
}
