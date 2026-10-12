import { useState, type ReactNode } from 'react'
import ContactMaterialReader from './ContactMaterialReader'
import { parseDeliverySource } from '../../../../shared/contact-source-navigation'
import { navigateContact } from './contactNavigation'
export default function ContactMaterialLink({ href, children }: { href: string; children: ReactNode }) {
  const [open, setOpen] = useState(false), [error, setError] = useState('')
  if (href.startsWith('contact-delivery://')) {
    const ref = parseDeliverySource(href)
    if (!ref) return <span>{children}（来源不可用）</span>
    return <><button type="button" data-delivery-source={href} onClick={() => { setError(''); void navigateContact({ kind: 'delivery', ref }).catch(e => setError(String(e))) }}>{children}</button>{error && <span role="alert">{error}</span>}</>
  }
  if (!href.startsWith('contact-material://')) return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
  let url: URL
  try { url = new URL(href) } catch { return <span>{children}（来源不可用）</span> }
  const [id, version] = url.pathname.slice(1).split('/')
  return <><button type="button" onClick={() => setOpen(true)}>{children}</button>{open && <ContactMaterialReader owner={decodeURIComponent(url.hostname)} reference={{ id, version: Number(version), start: Number(url.searchParams.get('start')), end: Number(url.searchParams.get('end')) }} topicId={url.searchParams.get('topic') || undefined} onClose={() => setOpen(false)} />}</>
}
