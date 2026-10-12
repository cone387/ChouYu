import { DELIVERY_THEME_TOKENS } from '../../../../shared/delivery-theme'
import { useEffect, useRef, useState } from 'react'
import type { AgentDelivery } from '../../../../shared/agent-delivery'
import type { ContentCitation, ReadingPosition } from '../../../../shared/contact-content'
import { validPresentationEvent } from './deliveryReading'

export default function ContactPresentation({ characterId, topicId, artifact, onFallback, onReading, onSelection }: {
  characterId: string; topicId: string; artifact: AgentDelivery; onFallback: () => void; onReading?: (position: ReadingPosition) => void; onSelection?: (citation: ContentCitation) => void
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [state, setState] = useState('loading')
  const [mode, setMode] = useState<'system' | 'original'>('system')
  const modeRef = useRef(mode); modeRef.current = mode
  const source = `chouyu-artifact://view/${encodeURIComponent(characterId)}/${encodeURIComponent(topicId)}/${artifact.version}`
  const nonce = useRef(crypto.randomUUID())
  const readingCallback = useRef(onReading); readingCallback.current = onReading
  const selectionCallback = useRef(onSelection); selectionCallback.current = onSelection
  const sendTheme = () => {
    const styles = getComputedStyle(document.documentElement)
    const tokens = Object.fromEntries(Object.entries(DELIVERY_THEME_TOKENS).map(([target, source]) => [target, styles.getPropertyValue(source).trim()]))
    frame.current?.contentWindow?.postMessage({ type: 'delivery-theme', theme: document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'), mode: modeRef.current, tokens }, '*')
    frame.current?.contentWindow?.postMessage({ type: 'delivery-reader-init', nonce: nonce.current, ref: { characterId, topicId, version: artifact.version } }, '*')
  }
  useEffect(sendTheme, [mode])
  useEffect(() => {
    setState('loading')
    const timeout = window.setTimeout(() => setState(s => s === 'loading' ? 'error' : s), 15000)
    const receive = (event: MessageEvent) => {
      const reading = validPresentationEvent(event, frame.current?.contentWindow ?? null, { characterId, topicId, version: artifact.version }, nonce.current, artifact.sections)
      if (reading) { if (event.data.type === 'delivery-selection') selectionCallback.current?.({ ref: reading.ref, anchor: reading.anchor }); else readingCallback.current?.(reading); return }
      if (event.origin !== 'null') return
      if (event.source !== frame.current?.contentWindow || event.data?.type !== 'delivery-preview' || !['ready', 'error'].includes(event.data.state)) return
      setState(s => s === 'error' ? s : event.data.state)
      sendTheme()
      window.clearTimeout(timeout)
    }
    window.addEventListener('message', receive)
    const observer = new MutationObserver(sendTheme)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-palette'] })
    return () => { observer.disconnect(); window.clearTimeout(timeout); window.removeEventListener('message', receive) }
  }, [source])
  return <div className="contact-presentation">
    <p className="agent-caption">自定义展示无法对应正文位置时，可切换正文继续定位。<button type="button" onClick={onFallback}>定位正文</button></p>
    <div className="agent-actions" aria-label="阅读配色"><button type="button" aria-pressed={mode === 'system'} onClick={() => setMode('system')}>跟随系统</button><button type="button" aria-pressed={mode === 'original'} onClick={() => setMode('original')}>作品原配色</button></div>
    {state === 'loading' && <p role="status">正在打开阅读页面…</p>}
    {state === 'error' && <p role="alert">自定义展示未能正常加载。<button type="button" onClick={onFallback}>阅读正文</button></p>}
    <iframe ref={frame} src={source} sandbox="allow-scripts" referrerPolicy="no-referrer" title={artifact.presentation?.title || '成果阅读页面'} onLoad={sendTheme} onError={() => setState('error')} />
  </div>
}
