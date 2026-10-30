import { useEffect, useState, type ReactNode } from 'react'
import type { AppConfig } from '../../../../shared/config'
import type { DashboardRange } from '../../../../shared/dashboard'
import type { SessionWorkspace } from '../../shared/types'
import type { WorkspacePage } from '../../core/workspace-state'
import { useContactVisible } from '../Contacts/useContactVisible'
import DashboardActivityPanel from './DashboardActivityPanel'
import { ChartPanel, TimeChart, DonutChart, HorizontalBars } from './DashboardCharts'
import { compactTokens, formatDuration, usagePoints } from './appDashboardModel'
import { useAppDashboard, type DashboardResource } from './useAppDashboard'
import './DashboardView.css'

function Resource<T>({ state, retry, children }: { state: DashboardResource<T>; retry: () => void; children: (data: T) => ReactNode }) {
  return <>{state.error && <p className="dashboard-error" role="alert">{state.error}<button type="button" onClick={retry}>重试</button></p>}
    {state.data ? children(state.data) : !state.error && <p className="dashboard-empty" role="status">正在读取…</p>}</>
}
export default function DashboardView({ active: surfaceActive, config, onOpenChat, onDeleted, onNavigate }: {
  active: boolean; config: AppConfig; onOpenChat(characterId: string): void; onDeleted(workspace: SessionWorkspace): void; onNavigate(page: WorkspacePage): void
}) {
  const active = useContactVisible(surfaceActive)
  const [range, setRange] = useState<DashboardRange>(7)
  const [reload, setReload] = useState(0)
  const app = useAppDashboard(active, range, reload)
  const retry = () => setReload(value => value + 1)
  const link = (page: WorkspacePage, label: string) => <button type="button" className="dashboard-module-link" onClick={() => onNavigate(page)}>{label}<span aria-hidden="true">↗</span></button>
  const usage = app.usage.data
  return <div className="dashboard-view" data-dashboard><div className="dashboard-scroll">
    <header className="dashboard-header"><h2>看板</h2>
      <div className="dashboard-period"><span>{app.today.replaceAll('-', '.')}</span><div role="group" aria-label="看板时间范围">{([7, 30] as const).map(days => <button type="button" key={days} aria-pressed={range === days} onClick={() => setRange(days)}>近 {days} 天</button>)}</div><button type="button" className="dashboard-refresh" aria-label="刷新看板" onClick={retry}>↻</button></div>
    </header>
    <div className="dashboard-overview" aria-label="App 概览">
      <div className="dashboard-metric dashboard-metric-blue"><span>全 App Token<small>近 {range} 天</small></span><strong data-app-metric="tokens" title={usage?.tokens?.toLocaleString('zh-CN')}>{usage?.tokens == null ? '—' : compactTokens(usage.tokens)}</strong><p>{usage ? `${usage.calls} 次调用${usage.calls > usage.reported ? ` · ${usage.calls - usage.reported} 次未上报` : ''}` : '正在读取用量'}</p></div>
      <button type="button" className="dashboard-metric dashboard-metric-teal" onClick={() => onNavigate('journal')}><span>活动记录时长<small>近 {range} 天</small></span><strong data-app-metric="duration">{app.journal.data?.durationMs === undefined ? '—' : formatDuration(app.journal.data.durationMs / 60000)}</strong><p>已采集的电脑活动</p></button>
      <button type="button" className="dashboard-metric dashboard-metric-gold" onClick={() => onNavigate('tasks')}><span>我的待办<small>当前</small></span><strong data-app-metric="todos">{app.tasks.data?.open ?? '—'}<small> 项</small></strong><p>近 {range} 天完成 {app.tasks.data?.completed ?? '—'} 项</p></button>
      <button type="button" className="dashboard-metric dashboard-metric-purple" onClick={() => onNavigate('chat')}><span>未读消息<small>当前</small></span><strong data-app-metric="unread">{app.sessions.data?.unread ?? '—'}<small> 条</small></strong><p>{app.sessions.data?.count ?? '—'} 个会话</p></button>
    </div>
    <div className="dashboard-first-row">
      <DashboardActivityPanel active={active} config={config} onOpenChat={onOpenChat} onDeleted={onDeleted} reload={reload} />
      <ChartPanel title="全 App Token 消耗" caption={`近 ${range} 天已记录用量 · 聊天、后台任务及其他模型请求`} className="dashboard-token-panel">
        <Resource state={app.usage} retry={retry}>{data => <>
          {data.collectionIssue && <p className="dashboard-error" role="alert">{data.collectionIssue}</p>}
          <TimeChart points={usagePoints(data)} unit="Token" label="全 App 每日 Token 消耗" axisFormat={compactTokens} missingLabel="用量未上报" />
          <p className="dashboard-note">统计自 {new Date(data.trackingSince).toLocaleDateString('zh-CN')}；旧版未记录的消耗无法追溯。{data.calls > data.reported && ` ${data.calls - data.reported} 次调用未上报用量，图中仅含已记录部分。`}</p>
        </>}</Resource>
      </ChartPanel>
    </div>
    <div className="dashboard-chart-grid">
      <ChartPanel title="每日电脑活动时长" caption={`近 ${range} 天 · 按活动记录统计，单位：小时`} className="dashboard-time-panel" action={link('journal', '查看活动')}>
        <Resource state={app.journal} retry={retry}>{data => <>
          {data.failedDays > 0 && <p role="alert" className="dashboard-error">{data.failedDays} 天读取失败，图中保留空缺。<button type="button" onClick={retry}>重试</button></p>}
          <TimeChart points={data.points.map(point => ({ ...point, value: point.value === null ? null : point.value / 60 }))} unit="小时" label="每日电脑活动记录时长" bars />
          <p className="dashboard-note">只统计开启活动记录后采集到的电脑使用时段，不等于专注时长。</p>
        </>}</Resource>
      </ChartPanel>
      <ChartPanel title="任务完成情况" caption="当前保留任务 · 不含归档清单" className="dashboard-todo-panel" action={link('tasks', '查看任务')}>
        <Resource state={app.tasks} retry={retry}>{data => <>
          <DonutChart label="用户任务完成分布" centerLabel="任务总数" items={[{ id: 'done', label: '已完成', value: data.done }, { id: 'open', label: '待完成', value: data.open }]} />
          <p className="dashboard-chart-subtitle">近 {range} 天完成 <strong>{data.completed}</strong> 项</p>
        </>}</Resource>
      </ChartPanel>
      <ChartPanel title="哪些应用用得多" caption={`近 ${range} 天 · 已记录的应用使用时长`} action={link('journal', '查看活动')}>
        <Resource state={app.journal} retry={retry}>{data => <>{data.failedDays > 0 && <p className="dashboard-note">仅显示成功读取日期的时长。</p>}<HorizontalBars items={data.apps} unit="" format={formatDuration} /></>}</Resource>
      </ChartPanel>
      <ChartPanel title="Token 用在哪些模型" caption={`近 ${range} 天 · 按已上报消耗排序`}>
        <Resource state={app.usage} retry={retry}>{data => <HorizontalBars items={data.models.map(model => ({ id: model.model, label: model.model, value: model.tokens, note: model.calls > model.reported ? `${model.calls - model.reported} 次未上报` : undefined }))} unit="Token" format={compactTokens} />}</Resource>
      </ChartPanel>
      <ChartPanel title="会话分布" caption="当前保留会话 · 累计消息数" action={link('chat', '查看会话')}>
        <Resource state={app.sessions} retry={retry}>{data => <SessionDistribution data={data} active={active} onOpenChat={onOpenChat} />}</Resource>
      </ChartPanel>
    </div>
  </div></div>
}

function SessionDistribution({ data, active, onOpenChat }: { data: NonNullable<ReturnType<typeof useAppDashboard>['sessions']['data']>; active: boolean; onOpenChat(id: string): void }) {
  const [names, setNames] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!active) return
    let alive = true
    const refresh = () => { void window.electronAPI.characters.list().then(list => { if (alive) setNames(Object.fromEntries(list.map(character => [character.id, character.name]))) }).catch(() => {}) }
    refresh(); const dispose = window.electronAPI.characters.onChanged(refresh)
    return () => { alive = false; dispose() }
  }, [active])
  return <><HorizontalBars items={data.byCharacter.map(item => ({ ...item, label: names[item.id] ?? '联系人' }))} unit="条" onSelect={onOpenChat} />
    <p className="dashboard-note">共 {data.count} 个会话，{data.messages.toLocaleString('zh-CN')} 条消息（含主动消息）。</p></>
}
