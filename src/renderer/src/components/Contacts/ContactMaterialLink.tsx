import { useState, type ReactNode } from 'react'
import ContactMaterialReader from './ContactMaterialReader'
export default function ContactMaterialLink({ href, children }: { href: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  if (!href.startsWith('contact-material://')) return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
  let url: URL
  try { url = new URL(href) } catch { return <span>{children}（来源不可用）</span> }
  const [id, version] = url.pathname.slice(1).split('/')
  return <><button type="button" onClick={() => setOpen(true)}>{children}</button>{open && <ContactMaterialReader owner={decodeURIComponent(url.hostname)} reference={{ id, version: Number(version), start: Number(url.searchParams.get('start')), end: Number(url.searchParams.get('end')) }} topicId={url.searchParams.get('topic') || undefined} onClose={() => setOpen(false)} />}</>
}
