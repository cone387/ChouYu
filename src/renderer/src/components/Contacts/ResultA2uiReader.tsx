import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { A2uiSurface, createComponentImplementation, type ReactCatalogComponent } from '@a2ui/react'
import { Catalog, MessageProcessor, type SurfaceModel } from '@a2ui/web_core'
import { z } from 'zod'
import { readingSchema } from './readingSchema'
import { createResultReadingSurface, RESULT_READING_CATALOG } from '../../../../shared/result-a2ui'
import type { ResultSourceSnapshot } from '../../../../shared/result-design'
import type { ResultReadingLayout } from '../../../../shared/result-reading-layout'
import ContactMarkdown from './ContactMarkdown'
import ResultReadingSources from './ResultReadingSources'
import { readingScrollContainer, readingArticleBounds, readingScrollRatio } from './deliveryScroll'
import './ResultA2uiReader.css'

type Reading = ReturnType<typeof createResultReadingSurface>
const ReadingContext = createContext<{ saved: Reading; navigate(index: number): void } | null>(null)
function useReading() {
  const value = useContext(ReadingContext)
  if (!value) throw new Error('成果阅读来源不可用。')
  return value
}

const Document = createComponentImplementation({
  name: 'ReadingDocument', schema: readingSchema(z.object({ children: z.array(z.string()).max(300).describe('REF:ChildList') }))
}, ({ props, buildChild }) => {
  const { saved } = useReading()
  return <div className={`result-a2ui-document result-a2ui-${saved.layout.kind}`} data-reading-kind={saved.layout.kind}><header><h2>{saved.title}</h2></header>
    {Array.isArray(props.children) && props.children.map(child => typeof child === 'string'
      ? <div key={child}>{buildChild(child)}</div>
      : <div key={`${child.id}:${child.basePath}`}>{buildChild(child.id, child.basePath)}</div>)}
  </div>
})
const Contents = createComponentImplementation({ name: 'ReadingContents', schema: readingSchema(z.object({})) }, () => {
  const { saved, navigate } = useReading()
  if (saved.sections.length < 2) return null
  return <details className="result-a2ui-contents" open><summary>目录</summary><nav aria-label="成果分节目录">
    {saved.layout.sections.map(s => { const index = saved.sections.findIndex(section => section.id === s.id), section = saved.sections[index]
      return <button type="button" key={section.id} onClick={() => navigate(index)}>{section.title || `分节 ${index + 1}`}</button>
    })}
  </nav></details>
})
const Sections = createComponentImplementation({ name: 'ReadingSections', schema: readingSchema(z.object({ children: z.array(z.string()).max(300).describe('REF:ChildList') })) }, ({ props, buildChild }) =>
  <div className="result-a2ui-sections">{Array.isArray(props.children) && props.children.map(child => <div className="result-a2ui-section-slot" key={typeof child === 'string' ? child : child.id}>
    {typeof child === 'string' ? buildChild(child) : buildChild(child.id, child.basePath)}
  </div>)}</div>
)
const Section = createComponentImplementation({
  name: 'SavedSection', schema: readingSchema(z.object({ sectionIndex: z.number().int().min(0).max(299), treatment: z.enum(['body', 'emphasis']) }))
}, ({ props }) => {
  const { saved } = useReading()
  if (typeof props.sectionIndex !== 'number') throw new Error('成果分节编号无效。')
  const section = saved.sections[props.sectionIndex]
  if (!section) throw new Error('成果分节不存在。')
  return <section className={`result-a2ui-section result-a2ui-${props.treatment}`} data-reading-section={props.sectionIndex} data-result-section={section.id} tabIndex={-1}>
    {!(saved.sections.length === 1 && (section.title === saved.title || /^(正文|正式成果|成果|执行结果|本次结果)$/.test(section.title))) && <h3>{section.title}</h3>}<ContactMarkdown imageMode="link">{section.body}</ContactMarkdown>
    <ResultReadingSources sources={section.sources}/>
  </section>
})

export type ResultReadingNavigation = { active?: boolean; initialSectionId?: string; onReadingPosition?(sectionId: string, ratio: number): void }
export default function ResultA2uiReader({ source, layout, onError, active = true, initialSectionId, onReadingPosition }: ResultReadingNavigation & { source: ResultSourceSnapshot; layout?: ResultReadingLayout; onError(): void }) {
  const root = useRef<HTMLDivElement>(null)
  const fail = useRef(onError); fail.current = onError
  const positionCallback = useRef(onReadingPosition); positionCallback.current = onReadingPosition
  const located = useRef('')
  const [ready, setReady] = useState<{ saved: Reading; surface: SurfaceModel<ReactCatalogComponent> }>()
  useEffect(() => {
    let processor: MessageProcessor<ReactCatalogComponent> | undefined
    let errors: { unsubscribe(): void } | undefined
    try {
      const saved = createResultReadingSurface(source, layout)
const catalog = new Catalog<ReactCatalogComponent>(RESULT_READING_CATALOG, '1.0', [Document, Contents, Sections, Section])
      processor = new MessageProcessor<ReactCatalogComponent>([catalog], undefined, { errorHandler: () => fail.current() })
      errors = processor.model.onError.subscribe(error => { console.warn('Result reading SDK error', error); fail.current() })
      processor.processMessages([...saved.messages])
      const surface = processor.model.surfacesMap.get(saved.surfaceId)
      if (!surface) throw new Error('成果阅读界面未创建。')
      setReady({ saved, surface })
    } catch (error) { console.warn('Result reading initialization failed', error); fail.current() }
    return () => { errors?.unsubscribe(); processor?.dispose() }
  }, [source, layout])
  const navigate = (index: number) => {
    const section = root.current?.querySelector<HTMLElement>(`[data-reading-section="${index}"]`)
    if (!section) return
    const scroller = readingScrollContainer(section)
    scroller.scrollTop += section.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12
    section.focus({ preventScroll: true })
    const id = ready?.saved.sections[index]?.id
    if (id) positionCallback.current?.(id, 0)
  }
  useEffect(() => {
    const element = root.current
    if (!ready || !active || !initialSectionId || !element) return
    const key = `${ready.saved.surfaceId}:${initialSectionId}`
    if (located.current === key) return
    const index = ready.saved.sections.findIndex(section => section.id === initialSectionId)
    if (index < 0) return
    const locate = () => {
      if (!element.querySelector(`[data-reading-section="${index}"]`)) return false
      navigate(index); located.current = key; return true
    }
    if (locate()) return
    const observer = new MutationObserver(() => { if (locate()) observer.disconnect() })
    observer.observe(element, { subtree: true, childList: true })
    return () => observer.disconnect()
  }, [ready, initialSectionId, active])
  useEffect(() => {
    const element = root.current
    if (!ready || !element || !active) return
    const scroller = readingScrollContainer(element)
    const onScroll = (event: Event) => {
      if (!event.isTrusted || document.hidden || !element.getClientRects().length) return
      const top = scroller.getBoundingClientRect().top
      const sections = [...element.querySelectorAll<HTMLElement>('[data-result-section]')]
      const section = sections.find(s => s.getBoundingClientRect().bottom > top + 36 && s.getBoundingClientRect().top < top + scroller.clientHeight)
      if (!section?.dataset.resultSection) return
      positionCallback.current?.(section.dataset.resultSection, readingScrollRatio(scroller.scrollTop, scroller.clientHeight, readingArticleBounds(section, scroller)))
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [ready, active])
  return <div ref={root} className="result-a2ui-reader" data-result-a2ui>
    {ready ? <ReadingContext.Provider value={{ saved: ready.saved, navigate }}><A2uiSurface surface={ready.surface} /></ReadingContext.Provider>
      : <p role="status">正在打开成果…</p>}
  </div>
}
