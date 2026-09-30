import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './ContactMarkdown.css'
import { ContactLink } from './contactNavigation'

export default function ContactMarkdown({ children }: { children: string }) {
  return <div className="contact-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
    table: ({ children }) => <div className="contact-markdown-table" role="region" aria-label="成果表格" tabIndex={0}><table>{children}</table></div>,
    a: ({ href, children }) => <ContactLink href={href}>{children}</ContactLink>
  }}>{children}</ReactMarkdown></div>
}
