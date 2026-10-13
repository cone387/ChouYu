import { contactQueries } from './contactQueries'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ContactFile } from '../../../../shared/contact-files'
import { filePreviewDocument } from '../../../../shared/contact-file-preview'
import { navigateContact } from './contactNavigation'

function FileReader({ owner, id, onClose }: { owner: string; id: string; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null), label = useId(), [data, setData] = useState<{ file: ContactFile; bytes: Uint8Array }>(), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [url, setUrl] = useState(''), [html, setHtml] = useState(''), alive = useRef(true)
  useEffect(() => {
    alive.current = true; const previous = document.activeElement as HTMLElement | null; dialog.current?.showModal()
    let image = ''
    void window.electronAPI.agents.readContactFile(owner, id).then(result => {
      if (!alive.current) return
      setData(result)
      if (result.file.mediaType.startsWith('image/')) { image = URL.createObjectURL(new Blob([new Uint8Array(result.bytes)], { type: result.file.mediaType })); setUrl(image) }
      if (result.file.mediaType === 'text/html') setHtml(filePreviewDocument(new TextDecoder().decode(result.bytes), crypto.randomUUID()))
    }).catch(e => { if (alive.current) setError(String(e)) })
    return () => { alive.current = false; if (image) URL.revokeObjectURL(image); if (previous?.isConnected) previous.focus() }
  }, [owner, id])
  const text = data && (data.file.mediaType.startsWith('text/') || data.file.mediaType === 'application/json') ? new TextDecoder().decode(data.bytes) : ''
  return createPortal(<dialog ref={dialog} className="contact-task-dialog contact-file-reader" data-contact-file-reader data-interactive data-interactive-bounds aria-labelledby={label} onCancel={e => { e.preventDefault(); e.stopPropagation(); onClose() }} onKeyDown={e => { if (e.key === 'Escape') e.stopPropagation() }}>
    <h3 id={label}>{data?.file.name || '读取文件'}</h3>
    {data && <p className="agent-caption">{data.file.context.skillId} · {new Date(data.file.createdAt).toLocaleString()} · {data.file.bytes} 字节 · {data.file.deliveryRef ? `成果第 ${data.file.deliveryRef.version} 版` : '工作文件'}</p>}
    {html ? <iframe title="文件预览" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={html} style={{ width: '100%', height: '50vh', border: '1px solid var(--border)' }} /> : url ? <img src={url} alt={data?.file.name} style={{ maxWidth: '100%', maxHeight: '50vh' }} /> : text ? <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '50vh', overflow: 'auto' }}>{text}</pre> : data && <p>此格式可导出后查看。</p>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <footer><button type="button" onClick={onClose}>关闭</button>{data && <button type="button" data-contact-file-export onClick={() => { setError(''); void window.electronAPI.agents.exportContactFile(owner, id).then(saved => { if (alive.current) setNotice(saved ? '文件已导出。' : '已取消导出。') }).catch(e => { if (alive.current) setError(String(e)) }) }}>导出文件</button>}</footer>
  </dialog>, document.body)
}
export default function ContactFiles({ owner, topicId, fileIds, active = true }: { active?: boolean; owner: string; topicId?: string; fileIds?: string[] }) {
  const [files, setFiles] = useState<ContactFile[]>([]), [error, setError] = useState(''), [opened, setOpened] = useState<string>(), [loading, setLoading] = useState(true)
  const [historical, setHistorical] = useState<{ skillId: string; name: string; bytes: number; hash: string }[]>([]), [historyError, setHistoryError] = useState('')
  useEffect(() => { if (!active) return; let live = true; if (!topicId && !fileIds) void window.electronAPI.skills.workFiles(owner).then(files => { if (live) { setHistorical(files); setHistoryError('') } }).catch(() => { if (live) setHistoryError('历史工作目录暂时无法读取。') }); return () => { live = false } }, [owner, topicId, fileIds, active])
  useEffect(() => {
    if (!active) return
    let live = true, sequence = 0
    const read = async () => { const n = ++sequence; try { const result = await contactQueries.read(owner, 'fileList', [topicId], () => window.electronAPI.agents.fileList(owner, topicId)); if (live && n === sequence) { setFiles(result); setError('') } } catch (e) { if (live && n === sequence) setError(String(e)) } finally { if (live && n === sequence) setLoading(false) } }
    const off = contactQueries.watch(owner, read, 15000); return () => { live = false; off() }
  }, [owner, topicId, active])
  const listed = fileIds ? files.filter(f => fileIds.includes(f.id)) : files
  return <section data-contact-files><h3>{fileIds ? '此版本的成果文件' : '文件'}</h3>{loading && <p role="status">正在读取文件…</p>}{error && <p role="alert">{error}</p>}
    {['formal', 'work'].map(kind => { const items = listed.filter(f => kind === 'formal' ? f.deliveryRef : !f.deliveryRef); return items.length ? <section key={kind}><h4>{kind === 'formal' ? '成果文件' : '工作文件'}</h4><ul className="agent-memories">{items.map(file => <li key={file.id}><button type="button" data-contact-file={file.id} onClick={() => setOpened(file.id)}>{file.name}</button><p className="agent-caption">{file.context.skillId} · {new Date(file.createdAt).toLocaleString()} · {file.bytes} 字节</p><p className="agent-caption">{file.context.runId ? '来自任务执行' : '来自聊天会话'}{file.deliveryRef ? ` · 成果第 ${file.deliveryRef.version} 版` : ' · 尚未作为正式成果交付'}</p>{file.deliveryRef && <button type="button" onClick={() => void navigateContact({ kind: 'delivery', ref: file.deliveryRef! }).catch(e => setError(String(e)))}>打开来源成果</button>}<details><summary>来源与内容指纹</summary><p style={{ overflowWrap: 'anywhere' }}>{file.context.topicId ? `任务：${file.context.topicId} · 轮次：${file.context.runId}` : `会话：${file.context.sessionId} · 请求：${file.context.requestId}`}</p><code style={{ overflowWrap: 'anywhere' }}>{file.hash}</code></details></li>)}</ul></section> : null })}
    {!loading && !error && !listed.length && <p className="agent-caption">暂无归档文件。</p>}
    {!topicId && !fileIds && historical.some(old => !files.some(file => file.hash === old.hash && file.name === old.name && file.context.skillId === old.skillId)) && <section><h4>历史工作文件</h4><p className="agent-caption">以下文件尚未记录任务、会话或轮次归属，不作为正式成果。</p><ul>{historical.filter(old => !files.some(file => file.hash === old.hash && file.name === old.name && file.context.skillId === old.skillId)).map(file => <li key={`${file.skillId}:${file.name}`}>{file.name} · {file.skillId} · {file.bytes} 字节</li>)}</ul></section>}
    {historyError && <p role="alert">{historyError}</p>}
    {opened && <FileReader key={`${owner}:${opened}`} owner={owner} id={opened} onClose={() => setOpened(undefined)} />}
  </section>
}
