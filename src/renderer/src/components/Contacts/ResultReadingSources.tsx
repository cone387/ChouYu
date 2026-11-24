import type { ResultSection } from '../../../../shared/result-design'
import ContactMaterialLink from './ContactMaterialLink'

export default function ResultReadingSources({ sources }: { sources: ResultSection['sources'] }) {
  if (!sources.length) return null
  return <details className="result-a2ui-sources"><summary>参考来源（{sources.length}）</summary><ul>
    {sources.map((source, index) => <li key={index}>{/^(https?:\/\/|contact-delivery:\/\/|contact-material:\/\/)/.test(source.url)
      ? <ContactMaterialLink href={source.url}>{source.title || source.url}</ContactMaterialLink> : <span>{source.title || source.url}</span>}</li>)}
  </ul></details>
}
