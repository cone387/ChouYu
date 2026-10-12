import { useEffect, useState } from 'react'
import type { ContactContextRecord } from '../../../../shared/contact-content'
import type { ContactMemory } from '../../../../shared/contact-memories'
export default function ContactContextReferences({ record }: { record: ContactContextRecord }) {
  const [versions, setVersions] = useState<ContactMemory[] | null>(null), [error, setError] = useState(''), [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    let alive = true
    const refresh = async () => {
      try {
        const values = await Promise.all(record.memories.map(async ref => {
          const history = await window.electronAPI.agents.memoryHistory(record.characterId, ref.id)
          return history.find(m => m.revision === ref.revision)
        }))
        if (alive) { setVersions(values.filter((v): v is ContactMemory => Boolean(v))); setError('') }
      } catch { if (alive) { setVersions(null); setError('参考记忆已移除或暂时无法读取。') } }
    }
    void refresh()
    const off = window.electronAPI.agents.onChanged(id => { if (id === record.characterId) void refresh() })
    return () => { alive = false; off() }
  }, [open, record])
  if (!record.memories.length) return null
  return <details className="contact-context-references" onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>本次参考记忆 · {record.memories.length}{record.status === 'failed' ? ' · 请求失败' : ''}</summary>
    <p className="agent-caption">这些版本随请求提供给联系人，不表示每一条都被用于回答。{record.truncated ? '本次上下文未包含全部记忆。' : ''}</p>
    {error && <p role="status">{error}</p>}
    {versions?.map(memory => <p key={memory.id}>{memory.status === 'forgotten' ? '此记忆已移除。' : `第 ${memory.revision} 版：${memory.content}`}</p>)}
  </details>
}
