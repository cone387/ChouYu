import { validateCitation } from '../../agents/citations';
import { AgentMaterials } from '../../agents/materials';
import { AgentHandoffs } from '../../agents/handoffs';
import { AgentFiles } from '../../agents/files';
import { validateChapterContinuation } from '../../agents/chapter-continuation';
import { AgentTaskFailures } from '../../agents/task-failures';
import type Database from 'better-sqlite3';
import type { AgentSettings, AgentReport, AgentTopicProgress } from '../../../shared/agents';
import { AgentTopics, canResearch } from '../../agents/topics';
import { AgentNotices } from '../../agents/notices';
import { AgentDeliveries } from '../../agents/delivery';
import { type DeliveryUpdate } from '../../../shared/agent-delivery';
import type { ContactStoreOperations } from './operations';
interface Ports {
  getRun: ContactStoreOperations['getRun']
  assertLive: ContactStoreOperations['assertLive']
  materials: Pick<AgentMaterials, "get">
  portfolio: import('../../agents/portfolio').AgentPortfolio
  deliveries: Pick<AgentDeliveries, "get" | "commit">
  research: ContactStoreOperations['research']
  topics: Pick<AgentTopics, "get" | "presentation" | "advance">
  files: Pick<AgentFiles, "attach">
  handoffs: Pick<AgentHandoffs, "completeReview">
  notices: Pick<AgentNotices, "enqueue" | "progress">
  remember: ContactStoreOperations['remember']
  event: ContactStoreOperations['event']
  taskFailures: Pick<AgentTaskFailures, "clear">
  profile: ContactStoreOperations['profile']
  completeCalendar: ContactStoreOperations['completeCalendar']
  pauseForTaskBudget: ContactStoreOperations['pauseForTaskBudget']
}

export class ContactCompletion {
  constructor(private db: Database.Database, private ports: Ports) {}
  finish(runId: string, report: AgentReport, memories: string[], progress?: AgentTopicProgress, delivery?: DeliveryUpdate): void {
    this.db.transaction(() => {
      if (this.ports.getRun(runId)?.status === 'completed') return
      const run = this.ports.assertLive(runId)
      const deliveryInput = JSON.parse(run.input)
      for (const ref of deliveryInput.contextReferences?.materials ?? []) {
        const value = this.ports.materials.get(run.character_id, ref)
        report = { ...report, evidence: [...report.evidence, { url: `contact-material://${encodeURIComponent(run.character_id)}/${value.id}/${value.version}?start=${ref.start}&end=${ref.end}${ref.topicId ? `&topic=${encodeURIComponent(ref.topicId)}` : ''}`, title: value.name, text: value.content.slice(ref.start, ref.end), capturedAt: value.createdAt, hash: value.hash }] }
      }
      if (deliveryInput.revisionCitation) {
        const citation = validateCitation(run.character_id, deliveryInput.revisionCitation, this.ports.portfolio)
        if (this.ports.deliveries.get(citation.ref.topicId)?.version !== citation.ref.version) throw new Error('引用的成果版本已变化，本轮修改未保存。')
      }
      if (deliveryInput.deliveryVersion === 1 && this.ports.research(runId)?.plan.action === 'write' && !delivery) throw new Error('写作成果缺少 delivery.section.body，变化摘要不能作为正文保存。')
      validateChapterContinuation({ delivery, progress, nextStep: report.nextStep }, deliveryInput.chapterContinuation?.decision, false)
      const previousDelivery = run.topic_id ? this.ports.deliveries.get(run.topic_id) : null
      const presentationOnly = deliveryInput.revisionScope === 'presentation'
      if (presentationOnly && (!previousDelivery || previousDelivery.version !== deliveryInput.revisionBaseVersion || !delivery || delivery.presentation === undefined || delivery.section || delivery.inputs || memories.length || delivery.summary !== previousDelivery.summary || delivery.completionCriteria !== previousDelivery.completionCriteria || JSON.stringify(delivery.stages) !== JSON.stringify(previousDelivery.stages))) throw new Error('样式修订版本已变化或试图修改正文与进度，本轮未保存。')
      if (deliveryInput.answeredInputs?.length) {
        const supplied = deliveryInput.answeredInputs as import('../../../shared/agent-delivery').TaskInputField[]
        const existing = delivery?.inputs ?? previousDelivery?.inputs ?? supplied
        const inputs = [...existing.filter(field => !supplied.some(answer => answer.id === field.id)), ...supplied]
        if (delivery) delivery = { ...delivery, inputs }
      }
      if (!presentationOnly && run.topic_id && progress?.status === 'completed' && this.ports.topics.get(run.character_id, run.topic_id).initialPlan) {
        if (!delivery) throw new Error('尚未提交实际成果和阶段验收，不能完成任务。')
        const requiredStages = [...this.ports.topics.get(run.character_id, run.topic_id).initialPlan!.stages, ...(previousDelivery?.stages ?? [])]
        if (requiredStages.some(stage => !delivery!.stages.some(next => next.id === stage.id && next.status === 'done'))) throw new Error('仍有计划阶段未交付或被遗漏，不能完成任务。')
      }
      if (deliveryInput.revisionSectionId && delivery?.section?.id !== deliveryInput.revisionSectionId) throw new Error('成果没有更新指定分节，本轮未提交。')
      if (run.topic_id && progress && JSON.parse(run.input).deliveryVersion === 1) this.ports.deliveries.commit(run.topic_id, report, progress, delivery)
      const committed = run.topic_id ? this.ports.deliveries.get(run.topic_id) : null
      if (delivery?.fileIds?.length) {
        if (!committed || committed.runId !== runId || !run.topic_id) throw new Error('工作文件尚无对应的正式成果。')
        this.ports.files.attach(run.character_id, { characterId: run.character_id, topicId: run.topic_id, version: committed.version }, delivery.fileIds)
      }
      if (progress?.status === 'completed' && committed?.runId === runId && this.ports.handoffs.completeReview(runId)) {
        progress = { ...progress, status: 'needs_evidence', nextStep: '等待原文有实质变化后继续评审。' }
        report = { ...report, nextStep: progress.nextStep }
      }
      this.db.prepare('INSERT OR IGNORE INTO reports(run_id,character_id,value) VALUES(?,?,?)').run(runId, run.character_id, JSON.stringify(report))
      if (run.topic_id) {
        if (!progress) throw new Error('缺少事项进展，本轮不能提交。')
        const before = this.ports.topics.get(run.character_id, run.topic_id)
        const previous = this.db.prepare('SELECT reports.value FROM reports JOIN runs ON runs.id=reports.run_id WHERE runs.topic_id=? AND runs.character_id=? AND runs.id<>? ORDER BY reports.rowid DESC LIMIT 1').get(run.topic_id, run.character_id, runId) as { value: string } | undefined
        if (presentationOnly) {
          this.ports.topics.presentation(run.character_id, run.topic_id, run.topic_revision!, runId)
          this.ports.notices.enqueue({ id: `${runId}:presentation`, purpose: 'presentation', characterId: run.character_id, topicId: run.topic_id, runId, topicRevision: before.revision + 1, kind: 'progress', createdAt: Date.now(), content: `「${before.title}」的阅读样式已保存为版本 ${previousDelivery!.version + 1}，正文与任务进度保持不变。可在任务成果中查看。` })
        } else {
          this.ports.topics.advance(run.character_id, run.topic_id, run.topic_revision!, progress, runId)
          const section = committed?.runId === runId ? committed.sections.find(s => s.runId === runId) : delivery?.section
          const deliveryChanged = Boolean(section && !previousDelivery?.sections.some(old => old.title === section.title && old.body === section.body))
          if (!delivery || section) this.ports.notices.progress(before, this.ports.topics.get(run.character_id, run.topic_id), report, previous ? JSON.parse(previous.value) : undefined, this.ports.research(runId)?.plan.action === 'write', deliveryChanged, section, committed?.runId === runId ? committed.version : undefined)
        }
      }
      for (const memory of memories.slice(0, 3)) {
        // A full library must not lose the report; record the reason explicitly.
        try { this.ports.remember(run.character_id, memory, runId) } catch { this.ports.event(runId, 'memory-skipped', '一条记忆未保存：内容含敏感信息或记忆库已满；成果仍保留。') }
      }
      this.db.prepare("UPDATE runs SET status='completed',summary=?,updated_at=? WHERE id=?").run(report.title, Date.now(), runId)
      if (!presentationOnly) this.ports.taskFailures.clear(run.character_id, run.topic_id)
      if (run.topic_id) this.db.prepare('DELETE FROM research_idle WHERE topic_id=?').run(run.topic_id)
      const research = this.ports.research(runId)
      if (research && !JSON.parse(run.input).calendar) {
        const settings = JSON.parse(this.ports.profile(run.character_id)!.settings) as AgentSettings
        const savedSection = committed?.runId === runId ? committed.sections.find(section => section.runId === runId) : delivery?.section
        const changedSection = savedSection && !previousDelivery?.sections.some(section => section.body.trim() === savedSection.body.trim())
        const previousReport = this.db.prepare('SELECT reports.value FROM reports JOIN runs ON runs.id=reports.run_id WHERE runs.topic_id=? AND runs.id<>? ORDER BY reports.rowid DESC LIMIT 1').get(run.topic_id, runId) as { value: string } | undefined
        const previousEvidence = new Set<string>(previousReport ? (JSON.parse(previousReport.value) as AgentReport).evidence.map(e => `${e.url}:${e.hash}`) : [])
        const newEvidence = report.evidence.some(e => !previousEvidence.has(`${e.url}:${e.hash}`))
        const continueImmediately = !settings.paceWriting && progress && canResearch(progress.status) && (changedSection || newEvidence) && !deliveryInput.feedback
        const nextAt = Date.now() + (continueImmediately ? 0 : Math.max(settings.intervalMinutes, research.plan.checkAfterMinutes) * 60000)
        this.db.prepare('UPDATE profiles SET next_at=? WHERE character_id=? AND focus_topic_id=?').run(nextAt, run.character_id, run.topic_id)
        this.db.prepare('UPDATE task_schedule SET next_at=? WHERE topic_id=?').run(nextAt, run.topic_id)
        this.db.prepare('UPDATE research SET value=? WHERE run_id=?').run(JSON.stringify({ ...research, nextCheckAt: nextAt }), runId)
        if (continueImmediately && settings.enabled) this.ports.event(runId, 'continuing', '本轮成果已保存，额度允许时将继续推进下一轮。')
        else if (research.plan.action === 'write' && !changedSection) this.ports.event(runId, 'deferred', '本轮没有新增或修改正文，按工作间隔再检查，避免重复消耗额度。')
      }
      this.ports.event(runId, 'completed', report.nextStep || '本轮工作完成。')
      if (!presentationOnly) this.ports.completeCalendar(run)
      if (!presentationOnly) this.ports.pauseForTaskBudget(runId)
    })()
  }
}
