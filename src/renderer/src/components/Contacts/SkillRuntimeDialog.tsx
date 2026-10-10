import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ContactSkill, SkillListing, SkillRunLog, SkillRuntimeStatus } from '../../../../shared/skills'

export default function SkillRuntimeDialog({ skill, characterId, revision, onChange, onClose }: { skill: ContactSkill; characterId: string; revision: number; onChange: (listing: SkillListing) => void; onClose: () => void }) {
  const element = useRef<HTMLDialogElement>(null), alive = useRef(true), pending = useRef(false), title = useId()
  const [status, setStatus] = useState<SkillRuntimeStatus>(), [logs, setLogs] = useState<SkillRunLog[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [selectedLog, setSelectedLog] = useState<string>()
  const refresh = async () => {
    const [status, logs] = await Promise.all([window.electronAPI.skills.runtimeStatus(), window.electronAPI.skills.logs(characterId, skill.id)])
    if (alive.current) { setStatus(status); setLogs(logs) }
  }
  useEffect(() => {
    alive.current = true
    const previous = document.activeElement as HTMLElement | null, dialog = element.current
    dialog?.showModal()
    void refresh().catch(error => { if (alive.current) setError(String(error)) })
    return () => { alive.current = false; dialog?.close(); if (pending.current) void window.electronAPI.skills.cancel(); if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  const run = async (action: () => Promise<unknown>) => {
    if (pending.current) return
    pending.current = true; setBusy(true); setError('')
    try { await action() } catch (error) { if (alive.current) setError(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : String(error)) }
    finally { if (alive.current) { await refresh().catch(() => {}); setBusy(false) }; pending.current = false }
  }
  const cancel = () => { if (pending.current) void window.electronAPI.skills.cancel(); else onClose() }
  const report = skill.compatibility
  return createPortal(<dialog ref={element} className="contact-task-dialog contact-skill-dialog" data-skill-runtime-dialog data-interactive data-interactive-bounds aria-labelledby={title} onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation() }} onCancel={event => { event.preventDefault(); event.stopPropagation(); cancel() }}>
    <form onSubmit={event => event.preventDefault()}>
      <h3 id={title}>{skill.name} · 能力与运行</h3>
      <p>说明与参考资料{skill.enabled ? '已启用' : '未启用'}；脚本{skill.scriptsEnabled ? '已授权' : '未授权'}。</p>
      <p className="agent-caption">说明可以独立使用。缺少的必要工具和外部账号仍会限制相关流程，可选脚本不会禁用整个技能。</p>
      <div className="skill-runtime-details">
        <h4>脚本与依赖</h4>
        {report?.scripts.length ? <ul>{report.scripts.map(script => <li key={script.path}>{script.path} <span className="agent-caption">{script.runtime}</span></li>)}</ul> : <p>未包含 Node、Python 或 Shell 脚本。</p>}
        {!!report?.dependencyFiles.length && <p>依赖清单：{report.dependencyFiles.join('、')}</p>}
        {!!report?.unsupportedFiles.length && <p>暂不支持执行：{report.unsupportedFiles.join('、')}</p>}
        {!!report?.externalRequirements.length && <><h4>需另行连接的外部能力</h4><ul>{report.externalRequirements.map((line, index) => <li key={index}>{line}</li>)}</ul></>}
        {!!report?.scripts.length && <>
          <h4>隔离运行环境</h4><p role="status">{status?.message || '正在检查环境…'}</p>
          <p className="agent-caption">脚本只访问该技能包和此联系人的技能工作目录，运行时无网络。单次最长 120 秒；成功后保存校验通过的工作文件，最多 8 MB、128 个文件，单文件 200 KB。后台常驻服务和浏览器视觉伴侣暂不支持。</p>
          <p className="agent-caption">依赖准备会联网下载，支持 package.json（禁用安装脚本）和 requirements.txt（仅预编译包），导出上限 64 MB。不传入聊天或模型密钥；其他清单、源码编译和外部账号需要另行适配。</p>
          <div className="skill-actions">
            <button type="button" data-skill-prepare-runtime disabled={busy || !status?.engineReady || status.ready} onClick={() => void run(() => window.electronAPI.skills.prepareRuntime())}>准备运行环境</button>
            {!!report.dependencyFiles.length && <button type="button" disabled={busy || !skill.enabled || !status?.ready} onClick={() => void run(() => window.electronAPI.skills.prepareDependencies(characterId, skill.id))}>准备技能依赖</button>}
            <button type="button" data-skill-scripts disabled={busy || (!skill.scriptsEnabled && (!skill.enabled || !status?.ready))} onClick={() => void run(async () => { const listing = await window.electronAPI.skills.configure(characterId, skill.id, skill.scriptsEnabled ? 'disable_scripts' : 'enable_scripts', revision); if (alive.current) onChange(listing) })}>{skill.scriptsEnabled ? '停用脚本' : '允许隔离运行脚本'}</button>
          </div>
        </>}
        <h4>运行记录</h4>
        <button type="button" disabled={busy} onClick={() => void run(refresh)}>刷新记录</button>
        {!logs.length && <p className="agent-caption">暂无运行记录。</p>}
        {logs.map(log => <div className="skill-runtime-log" key={log.id}><button type="button" onClick={() => setSelectedLog(selectedLog === log.id ? undefined : log.id)}>{new Date(log.startedAt).toLocaleString()} · {log.script || (log.kind === 'environment' ? '准备环境' : '准备依赖')} · {{ running: '运行中', completed: '成功', failed: '失败', cancelled: '已取消', interrupted: '已中断' }[log.status]}</button>{selectedLog === log.id && <pre className="skill-content">{log.error ? `${log.error}\n` : ''}{log.output || '无输出'}</pre>}</div>)}
      </div>
      {error && <p className="agent-error" role="alert">{error}</p>}
      <footer><button type="button" onClick={cancel}>{busy ? '取消操作' : '关闭'}</button></footer>
    </form>
  </dialog>, document.body)
}
