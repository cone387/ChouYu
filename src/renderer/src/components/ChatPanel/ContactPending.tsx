import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ContactInteraction } from '../../../../shared/contact-interactions'
import { DEFAULT_CHARACTER_ID } from '../../../../shared/characters'
import ContactInteractionCard from './ContactInteractionCard'
import './ContactInteractionCard.css'

type Item = ContactInteraction & { characterName: string }
export default function ContactPending({ characterId }: { characterId: string }) {
  const [items, setItems] = useState<Item[]>([]), [error, setError] = useState(''), [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [shown, setShown] = useState<Item[]>([])
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null)
  const refreshRef = useRef<() => void>(() => {})
  useEffect(() => {
    let alive = true, sequence = 0
    const refresh = async () => {
      const ticket = ++sequence
      try {
        const next = await window.electronAPI.agents.pendingInteractions(characterId)
        if (!alive || ticket !== sequence) return
        setItems(next); setError(''); setLoaded(true)
      } catch (e) { if (alive && ticket === sequence) setError(e instanceof Error ? e.message : '待处理事项读取失败') }
    }
    refreshRef.current = () => void refresh()
    void refresh()
    const off = window.electronAPI.agents.onChanged(id => { if (id === characterId || characterId === DEFAULT_CHARACTER_ID) void refresh() })
    return () => { alive = false; off() }
  }, [characterId])
  useEffect(() => {
    if (open) setShown(previous => [...previous, ...items.filter(item => !previous.some(p => p.id === item.id && p.characterId === item.characterId))])
  }, [items, open])
  const close = () => { setOpen(false); trigger.current?.focus() }
  useEffect(() => {
    if (open) dialog.current?.showModal()
    else dialog.current?.close()
  }, [open])
  useEffect(() => {
    window.addEventListener('chouyu:contact-navigation-opened', close)
    return () => window.removeEventListener('chouyu:contact-navigation-opened', close)
  }, [])
  return <>
    <button type="button" ref={trigger} aria-haspopup="dialog" data-contact-pending={characterId} onClick={() => { setShown(items); setOpen(true); refreshRef.current() }}>待处理{error ? ' · 读取失败' : loaded ? ` ${items.length}` : ' …'}</button>
    {createPortal(<dialog ref={dialog} className="contact-pending-dialog" aria-label="待处理事项" onCancel={e => { e.preventDefault(); close() }}>
      <header><strong>待处理事项</strong><button type="button" aria-label="关闭待处理事项" onClick={close}>关闭</button></header>
      {error && <p role="alert">{error}<button type="button" onClick={() => refreshRef.current()}>重新读取</button></p>}
      {!error && !loaded && <p role="status">正在读取…</p>}
      {!error && loaded && !shown.length && <p>目前没有需要你处理的事项。</p>}
      {open && shown.map(item => <article key={`${item.characterId}:${item.id}`}><h3>{item.characterName}</h3><ContactInteractionCard characterId={item.characterId} interactionId={item.id} fallback="待处理事项" /></article>)}
    </dialog>, document.body)}
  </>
}
