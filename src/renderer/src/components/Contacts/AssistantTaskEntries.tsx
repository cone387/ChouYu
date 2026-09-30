import { useEffect, useState } from 'react'
import { ASSISTANT_DUTIES, type AssistantDutyKey } from '../../../../shared/assistant-duties'
import type { AppConfig } from '../../../../shared/config'
import type { AssistantRoutine } from '../../../../shared/assistant-routines'
import { DEFAULT_CHARACTER_ID } from '../../../../shared/characters'
import ContactTaskDialog from './ContactTaskDialog'

export type AssistantTaskEntry = { id: string; title: string; status: string; description: string; duty?: AssistantDutyKey; routine?: AssistantRoutine }
export function useAssistantTasks(active: boolean) {
  const [routines, setRoutines] = useState<AssistantRoutine[]>([])
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const refresh = async () => {
    try {
      const [items, settings] = await Promise.all([window.electronAPI.assistantRoutines.list(), window.electronAPI.db.getConfig()])
      setRoutines(items); setConfig(settings); setLoaded(true); setError('')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  useEffect(() => {
    if (!active) return
    void refresh()
    const off = window.electronAPI.assistantRoutines.onChanged(() => { void refresh() })
    const offConfig = window.electronAPI.onConfigChanged(setConfig)
    const timer = setInterval(() => { void refresh() }, 15000)
    return () => { off(); offConfig(); clearInterval(timer) }
  }, [active])
  const entries: AssistantTaskEntry[] = !active ? [] : [
    ...(config ? ASSISTANT_DUTIES.map(duty => ({ id: `duty:${duty.key}`, title: duty.title, status: config[duty.key] ? '已启用' : '已暂停', description: duty.rule, duty: duty.key })) : []),
    ...routines.map(routine => ({ id: `routine:${routine.id}`, title: routine.title, status: routine.enabled ? '已启用' : '已暂停', description: routine.instruction, routine })),
    ...(loaded && !routines.some(item => item.kind === 'contact-summary') ? [{ id: 'morning-summary', title: '联系人晨间总结', status: '待安排', description: '告诉我希望几点检查各联系人的进展，我会按时汇总需要你关注的事情。' }] : [])
  ]
  return { entries, config, error, refresh }
}

export function AssistantTaskDetail({ entry, config, onChanged, onSelect }: {
  entry: AssistantTaskEntry; config: AppConfig | null; onChanged: () => Promise<void>; onSelect: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const routine = entry.routine
  const perform = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try { await action(); await onChanged() } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  return <>
    {editing && <ContactTaskDialog characterId={DEFAULT_CHARACTER_ID} routine={routine}
      initialDescription={routine ? '' : '每天早上检查各联系人的进展，汇总需要我关注和回复的事情。'}
      onClose={() => setEditing(false)} onAction={perform} onDone={() => {}}
      onRoutineDone={item => { onSelect(`routine:${item.id}`); void onChanged() }} />}
    <div className="agent-actions">
      {entry.duty && config && <button type="button" disabled={busy} onClick={() => void perform(() => window.electronAPI.db.saveConfig({ [entry.duty!]: !config[entry.duty!] }))}>{config[entry.duty] ? '暂停' : '启用'}</button>}
      {routine && <button type="button" disabled={busy} onClick={() => void perform(() => window.electronAPI.assistantRoutines.save({ ...routine, enabled: !routine.enabled }, routine.id, routine.revision))}>{routine.enabled ? '暂停' : '恢复'}</button>}
      {!entry.duty && <button type="button" disabled={busy} onClick={() => setEditing(true)}>{routine ? '修改任务' : '交给 ChouYu 安排'}</button>}
      {routine && <button type="button" disabled={busy} onClick={() => setDeleting(true)}>删除任务</button>}
    </div>
    {deleting && routine && <div role="alert"><p>确定删除「{routine.title}」？</p><button disabled={busy} onClick={() => void perform(async () => { await window.electronAPI.assistantRoutines.remove(routine.id, routine.revision); onSelect('') })}>确认删除</button><button disabled={busy} onClick={() => setDeleting(false)}>取消</button></div>}
    {error && <p role="alert" className="agent-error">{error}</p>}
    <dl className="topic-overview-meta"><div><dt>状态</dt><dd>{entry.status}</dd></div><div><dt>任务描述</dt><dd>{entry.description}</dd></div>
      {routine && <>
        <div><dt>执行时间</dt><dd>{routine.cadence === 'daily' ? '每天' : routine.cadence === 'weekdays' ? '工作日' : `每周${'日一二三四五六'[routine.weekday ?? 0]}`} {routine.time}（电脑本地时间）</dd></div>
        {routine.enabled && <div><dt>{routine.retryAt ? '下次重试' : '下次执行'}</dt><dd>{new Date(routine.retryAt ?? routine.nextAt).toLocaleString()}</dd></div>}
        {routine.lastAt && <div><dt>最近完成</dt><dd>{new Date(routine.lastAt).toLocaleString()} · 已发到 ChouYu 聊天</dd></div>}
      </>}
    </dl>
    {routine?.lastError && <p role="status" className="agent-error">最近执行未成功：{routine.lastError}；系统会自动重试。</p>}
    {routine && <><h4>任务成果</h4><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{routine.lastResult || '执行后会在这里显示最近结果。'}</p><p className="agent-caption">应用退出期间暂停，重新打开后合并补执行一次。</p></>}
  </>
}
