import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useId } from 'react'
import './ContactMarkdown.css'
import { ContactLink } from './contactNavigation'

export default function ContactMarkdown({ children, imageMode }: { children: string; imageMode?: 'link' }) {
  const anchorPrefix = `prose-${useId().replace(/:/g,'')}-`
  return <div className="contact-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} remarkRehypeOptions={{ clobberPrefix: anchorPrefix }} skipHtml components={{
    table: ({ children }) => <div className="contact-markdown-table" role="region" aria-label="成果表格" tabIndex={0}><table>{children}</table></div>,
    ...(imageMode === 'link' ? { img: ({ src, alt }: { src?: string; alt?: string }) => <span data-reading-image-alt={alt ?? ''} className="result-reading-image"><ContactLink href={src}>{alt || '查看图片'}</ContactLink></span> } : {}),
    a: ({ node: _node, ...props }) => props.href?.startsWith('#') ? <a {...props} /> : <ContactLink href={props.href}>{props.children}</ContactLink>
  }}>{children}</ReactMarkdown></div>
}
