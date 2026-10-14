import { resolveContactOutput } from '../../../../shared/contact-output'
import ContactMarkdown from './ContactMarkdown'
import './ContactOutput.css'

/** Only trusted layout choices affect the complete, saved Markdown body. */
export default function ContactOutput({ body, descriptor, preferences = [], collapsible = false }: {
  body: string; descriptor?: unknown; preferences?: unknown[]; collapsible?: boolean
}) {
  const output = resolveContactOutput(descriptor, preferences)
  const content = <ContactMarkdown>{body}</ContactMarkdown>
  return <div className="contact-output" data-contact-output={output.kind} data-output-density={output.density}>
    {collapsible && body.length > 4000 ? <details open><summary>正文（展开 / 收起）</summary>{content}</details> : content}
  </div>
}
