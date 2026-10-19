import { app, powerMonitor, type BrowserWindow } from 'electron'
import { existsSync, readFileSync, writeFileSync, renameSync, appendFileSync, readdirSync } from 'node:fs'
import Database from 'better-sqlite3'
import { auditAgentSpaceSoak, type AgentSpaceSoakEvidence } from './agentspace-soak-audit'
import { join, resolve } from 'node:path'
import { contactAgentsCall, restartAgentsForSmoke } from '../agents'
import { getConfig, getSessions, getSession, getAssistantUnreadCount, flushDatabase } from '../database'
import { DEFAULT_AGENT_SETTINGS, type AgentOverview } from '../../shared/agents'
import type { AgentDelivery } from '../../shared/agent-delivery'
import type { AssistantRoutine, AssistantRoutineHistoryPage } from '../../shared/assistant-routines'

type Options = { moduleAudit?: boolean; output: string; durationMs: number; restartMs: number; beganAt: number; gitHead: string; model: string; provider: string; providerHost: string }
type Report = { status: string; beganAt: number; updatedAt: number; elapsedMs: number; dates: string[]; heartbeats: number; appStarts: number; workerRestarted: boolean; appRestarted: boolean; topics: Record<string, string>; routineId?: string; observations: unknown; complete: boolean; gaps: { at: number; milliseconds: number }[]; errors: string[] }
const localDate = (at: number) => { const date = new Date(at); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
const clockAt = (minutes: number) => { const date = new Date(Date.now() + minutes * 60000); return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` }

/** Real production worker, models, calendars and durable notification outboxes. Never shifts the clock. */
export async function runContactSoak(window: BrowserWindow) {
  const options: Options = JSON.parse(readFileSync(process.env.CHOUYU_CONTACT_SOAK_OPTIONS!, 'utf8'))
  if (resolve(app.getPath('userData')) !== resolve(options.output, 'user-data') || process.env.CHOUYU_SMOKE_TEST !== '1') throw Error('Endurance requires isolated application data')
  const file = join(options.output, 'report.json'), events = join(options.output, 'events.jsonl')
  const report: Report = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { status: 'starting', beganAt: options.beganAt, updatedAt: options.beganAt, elapsedMs: 0, dates: [], heartbeats: 0, appStarts: 0, workerRestarted: false, appRestarted: false, topics: {}, observations: {}, complete: false, gaps: [], errors: [] }
  const moduleFile = join(options.output, 'module-evidence.json')
  const moduleEvidence: AgentSpaceSoakEvidence = existsSync(moduleFile) ? JSON.parse(readFileSync(moduleFile, 'utf8')) : {
    elapsedMs: 0, observedMs: 0, samples: 0, appStarts: 0, workerRestarted: false, pauseVerified: false, duplicateMessages: 0, storageErrors: 0,
    native: { completed: 0, calls: 0, reportedTokens: 0 }, dsh: { completed: 0, calls: 0, reportedTokens: 0 }, sdkSessions: 0, actualReviews: 0 }
  const saveModuleEvidence = () => {
    if (!options.moduleAudit) return
    writeFileSync(moduleFile + '.tmp', JSON.stringify(moduleEvidence, null, 2)); renameSync(moduleFile + '.tmp', moduleFile)
  }
  const save = () => { report.updatedAt = Date.now(); report.elapsedMs = Date.now() - report.beganAt; writeFileSync(join(options.output, 'report.tmp'), JSON.stringify(report, null, 2)); renameSync(join(options.output, 'report.tmp'), file) }
  const event = (kind: string, detail: unknown = {}) => appendFileSync(events, JSON.stringify({ at: Date.now(), kind, detail }) + '\n')
  const power = (kind: string) => () => event(kind)
  const suspend = power('actual-os-suspend'), resume = power('actual-os-resume')
  powerMonitor.on('suspend', suspend); powerMonitor.on('resume', resume)
  const run = (code: string) => window.webContents.executeJavaScript(code)
  report.appStarts++; report.status = 'running'; save(); event('app-start', { count: report.appStarts, model: options.model })
  const titles = { 'soak-writer': '灯塔故事持续写作', 'soak-reviewer': '灯塔故事独立评审' }
  const instructions = {
    'soak-writer': '持续写作合成灯塔故事，每个日历期次交付一段300至500字正文并正式保存。主角沈青，地点雾港，灯塔每周四亮蓝灯。沿用已经保存的故事进展，不重复旧段，不结束整个重复任务。不需要用户补问，不访问网页，不评价其他联系人。直接交付故事正文，不把计划或阶段状态当作成果。',
    'soak-reviewer': '持续独立评审验收作者的灯塔故事。每个日历期次先读取作者最新保存的正式正文，再直接给出结论、引用依据和一项具体建议，保存完整评审正文。不引用自己的旧评审冒充原文；没有新正文如实等待，不重复交付同一版评审，不改写作者任务。不要询问用户，继续保持重复任务。'
  }
  try {
    for (const [owner, title] of Object.entries(titles)) {
      let data = await contactAgentsCall<AgentOverview>(owner, 'get')
      let topic = data.topics.find(t => t.id === report.topics[owner]) ?? data.topics.find(t => t.title === title)
      if (!topic) {
        const times = [...new Set([clockAt(owner === 'soak-writer' ? 2 : 5), ...(options.moduleAudit && options.durationMs >= 86400000 ? [clockAt(owner === 'soak-writer' ? 60 : 63)] : []), owner === 'soak-writer' ? '00:03' : '00:06'])].sort()
        await contactAgentsCall(owner, 'assignCalendarTopic', [{ title, instruction: instructions[owner as keyof typeof instructions], kind: 'reminder', cadence: 'daily', times, enabled: true }, '隔离持续运行验收：真实日历，每期一次。'])
        data = await contactAgentsCall<AgentOverview>(owner, 'get'); topic = data.topics.find(t => t.title === title)!
        await contactAgentsCall(owner, 'savePreferences', [{ ...DEFAULT_AGENT_SETTINGS, ...data.settings, enabled: true, dailyCalls: 40, dailyTokenLimit: 160000, defaultTaskTokenLimit: 300000, maxConcurrentTasks: 1, searchEnabled: false, shareDeliveries: true, readContactDeliveries: owner === 'soak-reviewer', paceWriting: true, intervalMinutes: 15 }, data.revision])
        await contactAgentsCall(owner, 'setTaskBudget', [topic.id, topic.revision, { modelCalls: 40, tokens: 300000, reason: '隔离验收预先固定额度：最多40次调用和30万Token，失败和纠正均计入，不在运行中扩额。' }])
      }
      report.topics[owner] = topic.id; save()
    }
    const routines: AssistantRoutine[] = await run('window.electronAPI.assistantRoutines.list()')
    let routine = routines.find(r => r.id === report.routineId || r.title === '隔离验收联系人检查')
    if (!routine) {
      const input = { title: '隔离验收联系人检查', instruction: '检查验收作者和验收评审的实际工作与正式成果，简短告诉我各自真正交付了什么、有什么阻塞。没有正文不能声称交付，未完整读过原文不要评价质量，不替任何人答复或更改工作。', kind: 'contact-summary', cadence: 'daily', times: [...new Set([clockAt(8), '00:09'])].sort(), enabled: true }
      routine = (await run(`window.electronAPI.assistantRoutines.save(${JSON.stringify(input)})`)).find((r: AssistantRoutine) => r.title === input.title)
    }
    report.routineId = routine!.id; save()
    event('calendar-saved', { topics: report.topics, routineId: report.routineId, configuredModel: getConfig().model })
    let previous = Date.now(), observationFailures = 0
    const fullModuleDay = options.moduleAudit && options.durationMs >= 86400000
    while ((Date.now() - report.beganAt < options.durationMs || fullModuleDay && moduleEvidence.observedMs < 86400000) && Date.now() - report.beganAt < options.durationMs + 3600000) {
      if (existsSync(join(options.output, 'stop.request'))) { report.status = 'stopped'; save(); event('stop-request'); app.exit(2); return }
      const now = Date.now(), delta = now - previous; previous = now
      if (delta > 45000) report.gaps.push({ at: now, milliseconds: delta })
      if (!report.dates.includes(localDate(now))) report.dates.push(localDate(now))
      try {
        const writer = await contactAgentsCall<AgentOverview>('soak-writer', 'get'), reviewer = await contactAgentsCall<AgentOverview>('soak-reviewer', 'get')
        const history: AssistantRoutineHistoryPage = await run(`window.electronAPI.assistantRoutines.history(${JSON.stringify(report.routineId)})`)
        const deliveries = await Promise.all(['soak-writer', 'soak-reviewer'].map(owner => contactAgentsCall<AgentDelivery | null>(owner, 'delivery', [report.topics[owner]])))
        const messages = getSessions().flatMap(session => (getSession(session.id)?.messages ?? []).map(message => ({ id: message.id, characterId: session.characterId, agentNotice: message.agentNotice, content: message.content })))
        if (new Set(messages.map(message => message.id)).size !== messages.length) { moduleEvidence.duplicateMessages++; saveModuleEvidence(); throw Error('Duplicate delivered message ID') }
        const completedReceipts = history.items.filter(item => item.status === 'completed').map(item => item.receipt)
        if (new Set(completedReceipts).size !== completedReceipts.length) throw Error('Duplicate routine period receipt')
        const overview = (data: AgentOverview) => ({ revision: data.revision, tasks: data.topics.map(t => ({ id: t.id, status: t.status, calendar: t.calendar })), runs: data.runs, callsToday: data.callsToday, tokenUsage: data.tokenUsage, reports: data.reports, next: data.taskSchedule })
        report.observations = { writer: overview(writer), reviewer: overview(reviewer), deliveries, assistantHistory: history.items, messages, unread: getAssistantUnreadCount(), memory: app.getAppMetrics().map(metric => ({ type: metric.type, ...metric.memory })) }
        report.heartbeats++; observationFailures = 0; save()
        if (options.moduleAudit) {
          const database = new Database(join(app.getPath('userData'), 'contact-agents', 'agents.db'), { readonly: true })
          try {
            moduleEvidence.native = { completed: 0, calls: 0, reportedTokens: 0 }; moduleEvidence.dsh = { completed: 0, calls: 0, reportedTokens: 0 }
            const runs = database.prepare("SELECT id,status,json_extract(input,'$.backgroundHarnessEngine') AS engine FROM runs WHERE character_id IN ('soak-writer','soak-reviewer')").all() as { id: string; status: string; engine: 'native' | 'dsh' | null }[]
            for (const work of runs) {
              if (!work.engine) continue // Queued work has not selected an engine yet.
              if (!['native', 'dsh'].includes(work.engine)) throw Error('Unexpected persisted harness selection')
              const engine = moduleEvidence[work.engine]
              if (work.status === 'completed') engine.completed++
              const calls = database.prepare('SELECT metadata FROM calls WHERE run_id=?').all(work.id) as { metadata: string | null }[]
              engine.calls += calls.length
              for (const call of calls) {
                const usage = call.metadata ? JSON.parse(call.metadata).usage : undefined
                if (Number.isSafeInteger(usage?.totalTokens) && usage.totalTokens > 0) engine.reportedTokens += usage.totalTokens
              }
            }
          } finally { database.close() }
          const home = join(app.getPath('userData'), 'contact-agents', 'harness')
          moduleEvidence.sdkSessions = existsSync(home) ? readdirSync(home, { recursive: true }).filter(file => String(file).endsWith('.jsonl')).length : 0
          const diagnosticFile = join(app.getPath('userData'), 'contact-worker-diagnostics.log')
          if (existsSync(diagnosticFile)) {
            const diagnostics = readFileSync(diagnosticFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
            moduleEvidence.storageErrors = Math.max(moduleEvidence.storageErrors, diagnostics.filter(value => value.storage).length)
          }
          moduleEvidence.observedMs += Math.min(delta, 15000)
          moduleEvidence.samples++; moduleEvidence.elapsedMs = Date.now() - report.beganAt
          moduleEvidence.appStarts = report.appStarts; moduleEvidence.workerRestarted = report.workerRestarted
          moduleEvidence.actualReviews = reviewer.reports.filter(item => item.evidence.some(source => source.url.startsWith('contact-delivery://soak-writer/'))).length
          saveModuleEvidence()
          if (!moduleEvidence.pauseVerified && writer.reports.length && reviewer.reports.length && !writer.runs.some(work => ['running', 'queued'].includes(work.status))) {
            const topic = writer.topics.find(topic => topic.id === report.topics['soak-writer'])!
            await contactAgentsCall('soak-writer', 'topicStatus', [topic.id, topic.revision, 'paused', '隔离验收：暂停后核对持久状态与请求拒绝。'])
            const refused = await contactAgentsCall('soak-writer', 'run', [topic.id]).then(() => false, () => true)
            if (!refused) throw Error('Paused task accepted a new run')
            await new Promise(resolve => setTimeout(resolve, 5000))
            const paused = await contactAgentsCall<AgentOverview>('soak-writer', 'get')
            const saved = paused.topics.find(value => value.id === topic.id)!
            if (saved.status !== 'paused' || paused.callsToday !== writer.callsToday) throw Error('Paused task changed or dispatched inference')
            await contactAgentsCall('soak-writer', 'continueTopic', [topic.id, saved.revision, '隔离验收：恢复原日历任务。'])
            moduleEvidence.pauseVerified = true; saveModuleEvidence(); event('pause-verified-and-resumed')
          }
        }
        if (!report.workerRestarted && writer.runs.some(r => r.status === 'running')) {
          event('worker-interrupt-running')
          await restartAgentsForSmoke(); report.workerRestarted = true; save(); event('worker-restarted')
        }
        if (!report.appRestarted && now - report.beganAt >= options.restartMs && ![...writer.runs, ...reviewer.runs].some(r => ['running', 'queued'].includes(r.status))) {
          report.appRestarted = true; save(); await flushDatabase(); event('application-restart-request'); app.exit(75); return
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error); report.errors.push(message); event('observation-error', { message }); save()
        if (++observationFailures >= 3) { report.status = 'failed-observation'; save(); throw error }
      }
      await new Promise(resolve => setTimeout(resolve, 5000))
    }
    save()
    const observed = report.observations as { writer: { runs: { status: string }[]; reports: unknown[] }; reviewer: { runs: { status: string }[]; reports: { evidence: { url: string }[] }[] }; deliveries: (AgentDelivery | null)[]; assistantHistory: { status: string }[]; unread: number }
    const actualReviews = observed.reviewer.reports.filter(item => item.evidence.some(source => source.url.startsWith('contact-delivery://soak-writer/')))
    report.complete = options.durationMs >= 86400000 && report.elapsedMs >= 86400000 && report.dates.length >= 2 && report.workerRestarted && report.appRestarted
      && observed.writer.runs.filter(r => r.status === 'completed').length >= 2 && observed.deliveries.every(value => !!value?.sections.length)
      && observed.reviewer.runs.filter(r => r.status === 'completed').length >= 2
      && observed.writer.reports.length >= 2 && actualReviews.length >= 2
      && observed.assistantHistory.filter(item => item.status === 'completed').length >= 2 && observed.unread > 0 && report.errors.length === 0
    if (options.moduleAudit) {
      moduleEvidence.elapsedMs = report.elapsedMs; moduleEvidence.appStarts = report.appStarts; moduleEvidence.workerRestarted = report.workerRestarted
      saveModuleEvidence()
      const failed = auditAgentSpaceSoak(moduleEvidence)
      event('module-audit', { failed })
      report.complete = report.complete && failed.length === 0
    }
    report.status = report.complete ? 'passed-24-hours' : options.durationMs < 86400000 ? 'short-sample-only' : 'failed'; save()
    event('finished', { complete: report.complete, elapsedMs: report.elapsedMs, dates: report.dates })
    if (options.durationMs >= 86400000 && !report.complete) throw Error('Contact endurance acceptance incomplete; inspect isolated report')
  } finally { powerMonitor.removeListener('suspend', suspend); powerMonitor.removeListener('resume', resume) }
}
