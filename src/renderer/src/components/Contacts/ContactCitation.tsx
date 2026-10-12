import { useState } from 'react'
import type { ContentCitation } from '../../../../shared/contact-content'
import { navigateContact } from './contactNavigation'

export default function ContactCitation({ citation }: { citation: ContentCitation }) {
  const [error, setError] = useState('')
  return <aside className="contact-citation" aria-label="正文引用">
    <button type="button" onClick={() => { setError(''); void navigateContact({ kind: 'delivery', ...citation }).catch(e => setError(`来源已移除或暂时不可用：${e.message}`)) }}>查看引用原文 · 版本 {citation.ref.version}</button>
    {citation.anchor && <blockquote className="citation-quote">{citation.anchor.quote}</blockquote>}
    {error && <p role="alert">{error}</p>}
  </aside>
}
