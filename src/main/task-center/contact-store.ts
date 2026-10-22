import { ContactCompletion } from './contact/completion';
import { FeedbackLedger } from '../agents/feedback-ledger';
import { DeliveryDependencies } from '../agents/delivery-dependencies';
import { ContactMutations } from './contact/mutations';
import { ContactScheduling } from './contact/scheduling';
import { ContactCallBudget } from './contact/call-budget';
import { ContactQueries } from './contact/queries';
import type { ContactStoreOperations } from './contact/operations';
import { Profile } from './contact/types';

import { initializeCompletionReviews } from '../agents/completion-batches';
import { ContactCalendars } from '../agents/calendar';

import { AgentMemories } from '../agents/memories';
import { AgentMaterials } from '../agents/materials';
import { AgentHandoffs } from '../agents/handoffs';
import { AgentFiles } from '../agents/files';
import { contactHome } from '../agents/home';
import { cardHighlights } from '../../shared/contact-home';

import { AgentTaskFailures } from '../agents/task-failures';
import { ContactInteractions } from '../agents/interactions';
import { ContactActions } from '../agents/action-interactions';
import { ContactOutputPreferences } from '../agents/output-preferences';
import { AgentTokenBudget } from '../agents/token-budget';
import type Database from 'better-sqlite3';
import { openContactDatabase, contactStorageFailure } from '../storage/contact-database';

import type { AgentSettings } from '../../shared/agents';

import { AgentTopics } from '../agents/topics';
import { AgentNotices } from '../agents/notices';

import { AgentDeliveries } from '../agents/delivery';

export class ContactTaskStore {
  readonly completion: ContactCompletion
  readonly feedbackLedger: FeedbackLedger
  readonly dependencies: DeliveryDependencies
  readonly mutations: ContactMutations
  readonly scheduling: ContactScheduling
  readonly callBudget: ContactCallBudget
  readonly queries: ContactQueries
  readonly calendars: ContactCalendars
  readonly db: Database.Database
  readonly topics: AgentTopics
  readonly decisions: ContactInteractions
  readonly actions: ContactActions
  readonly outputs: ContactOutputPreferences
  readonly notices: AgentNotices
  readonly tokens: AgentTokenBudget
  readonly deliveries: AgentDeliveries
  get portfolio() { return this.deliveries.portfolio }
  readonly taskFailures: AgentTaskFailures
  readonly memoryLibrary: AgentMemories
  readonly materials: AgentMaterials
  readonly handoffs: AgentHandoffs
  readonly files: AgentFiles
  constructor(filename: string) {
    this.db = openContactDatabase(filename, 'tasks')
    try {
      this.db.pragma('foreign_keys = ON')
      // Schema, legacy bodies and the old-application barrier commit together.
      this.db.exec('BEGIN IMMEDIATE')
      const version = this.db.pragma('user_version', { simple: true }) as number
      if (version > 18) throw new Error('Agent 数据版本较新，请升级应用。')
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS profiles (character_id TEXT PRIMARY KEY, settings TEXT NOT NULL, revision INTEGER NOT NULL, next_at INTEGER NOT NULL, failures INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, character_id TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE, revision INTEGER NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, question TEXT NOT NULL DEFAULT '', answer TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', input TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS runs_character ON runs(character_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, kind TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS events_run_time ON events(run_id,at);
        CREATE TABLE IF NOT EXISTS calls (id INTEGER PRIMARY KEY, character_id TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS calls_character_time ON calls(character_id, at);
        CREATE TABLE IF NOT EXISTS reports (run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE, character_id TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, character_id TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE, content TEXT NOT NULL, run_id TEXT, created_at INTEGER NOT NULL, UNIQUE(character_id, content));
      `)
      this.topics = new AgentTopics(this.db)
      if (version < 2) this.db.transaction(() => {
        this.db.exec(`
          ALTER TABLE profiles ADD COLUMN focus_topic_id TEXT;
          ALTER TABLE runs ADD COLUMN topic_id TEXT;
          ALTER TABLE runs ADD COLUMN topic_revision INTEGER;
          CREATE TABLE topics (id TEXT PRIMARY KEY, character_id TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE, value TEXT NOT NULL);
          CREATE INDEX topics_character ON topics(character_id);
          CREATE INDEX runs_topic ON runs(topic_id, created_at DESC);
          CREATE TABLE topic_changes (id INTEGER PRIMARY KEY, topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE, kind TEXT NOT NULL, before_value TEXT, after_value TEXT NOT NULL, reason TEXT NOT NULL, run_id TEXT REFERENCES runs(id) ON DELETE CASCADE, created_at INTEGER NOT NULL);
          CREATE INDEX changes_topic ON topic_changes(topic_id,id DESC);
          CREATE UNIQUE INDEX changes_run ON topic_changes(run_id) WHERE run_id IS NOT NULL;
        `)
        for (const profile of this.db.prepare('SELECT * FROM profiles').all() as Profile[]) {
          const settings = JSON.parse(profile.settings) as AgentSettings
          if (settings.goal.trim()) {
            const topic = this.topics.create(profile.character_id, { title: settings.goal.slice(0, 160), goal: settings.goal, constraints: '' }, '由升级前的工作方向建立；旧报告保留在工作记录中，未推断其事项归属。')
            this.db.prepare('UPDATE profiles SET focus_topic_id=? WHERE character_id=?').run(topic.id, profile.character_id)
          }
        }
        this.db.pragma('user_version = 2')
      })()
      this.notices = new AgentNotices(this.db, notice => this.decisions.offer(notice), (owner, id) => {
        const view = this.decisions.get(owner, id)
        if (view.kind !== 'retry') return undefined
        return [`关于「${view.topicTitle}」：${view.failure?.message}`, view.impact, view.recoveryMessage].filter(Boolean).join('\n\n')
      })
      this.db.exec(`CREATE TABLE IF NOT EXISTS search_calls (id INTEGER PRIMARY KEY, character_id TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE,run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS search_calls_character ON search_calls(character_id,at);
        CREATE TABLE IF NOT EXISTS research (run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS research_idle (topic_id TEXT PRIMARY KEY REFERENCES topics(id) ON DELETE CASCADE,streak INTEGER NOT NULL);`)
      if (version < 5) this.db.transaction(() => {
        this.db.exec('DROP INDEX IF EXISTS changes_run; CREATE UNIQUE INDEX changes_run ON topic_changes(run_id,kind) WHERE run_id IS NOT NULL;')
        this.db.pragma('user_version = 5')
      })()
      this.deliveries = new AgentDeliveries(this.db)
      if (version < 7) this.db.transaction(() => {
        if (!(this.db.pragma('table_info(calls)') as { name: string }[]).some(column => column.name === 'metadata')) this.db.exec('ALTER TABLE calls ADD COLUMN metadata TEXT;')
        this.db.pragma('user_version = 7')
      })()
      // Retire legacy contact deadlines without changing modes, revisions or live checkpoints.
      this.db.prepare("UPDATE profiles SET settings=json_remove(settings, '$.workUntil') WHERE json_type(settings, '$.workUntil') IS NOT NULL").run()
      this.tokens = new AgentTokenBudget(this.db)
      this.decisions = new ContactInteractions(this)
      this.actions = new ContactActions(this)
      this.outputs = new ContactOutputPreferences(this)
      if (version < 8) this.db.transaction(() => { this.tokens.importHistory(); this.db.pragma('user_version = 8') })()
      if (version < 9) this.db.transaction(() => { this.portfolio.backfill(); this.db.pragma('user_version = 9') })()
      this.materials = new AgentMaterials(this.db)
      this.handoffs = new AgentHandoffs(this)
      this.dependencies = new DeliveryDependencies(this)
      this.memoryLibrary = new AgentMemories(this.db)
      if (version < 10) this.db.transaction(() => {
        // Scope is part of the new identity; equal text in different scopes must remain independent.
        this.db.exec(`ALTER TABLE memories RENAME TO memories_v9;
          CREATE TABLE memories(id TEXT PRIMARY KEY,character_id TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE,content TEXT NOT NULL,run_id TEXT,created_at INTEGER NOT NULL);
          INSERT INTO memories SELECT * FROM memories_v9;
          DROP TABLE memories_v9;
          CREATE INDEX memories_owner ON memories(character_id);`)
        this.memoryLibrary.migrateLegacy()
        this.db.pragma('user_version = 10')
      })()
      if (version < 11) this.db.pragma('user_version = 11')
      if (version < 12) this.db.pragma('user_version = 12')
      this.files = new AgentFiles(this.db)
      if (version < 13) this.db.pragma('user_version = 13')
      initializeCompletionReviews(this.db)
      this.db.exec(`CREATE TABLE IF NOT EXISTS work_settings_changes (
        id INTEGER PRIMARY KEY, character_id TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE,
        revision INTEGER NOT NULL, before_value TEXT NOT NULL, after_value TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL);`)
      if (version < 14) this.db.pragma('user_version = 14')
      this.db.exec(`CREATE TABLE IF NOT EXISTS activity_heartbeats (id INTEGER PRIMARY KEY, topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE, started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS activity_heartbeats_topic ON activity_heartbeats(topic_id,ended_at);`)
      this.db.exec(`CREATE TABLE IF NOT EXISTS task_schedule (
        topic_id TEXT PRIMARY KEY REFERENCES topics(id) ON DELETE CASCADE,
        conversation TEXT NOT NULL DEFAULT '', pending INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0);`)
      this.taskFailures = new AgentTaskFailures(this.db)
      this.calendars = new ContactCalendars(this.db)
      if (version < 16) this.db.pragma('user_version = 16')
      this.db.exec('CREATE TABLE IF NOT EXISTS execution_cleanup (character_id TEXT NOT NULL, request_id TEXT NOT NULL, PRIMARY KEY(character_id,request_id));')
      if (version < 17) this.db.pragma('user_version = 17')
      this.queries = new ContactQueries(this.db, {
        topics: this.topics,
        callCount: this.callCount.bind(this),
        calendars: this.calendars,
        taskFailures: this.taskFailures,
        tokens: this.tokens,
        searchCount: this.searchCount.bind(this),
        memoryLibrary: this.memoryLibrary
      })
      this.callBudget = new ContactCallBudget(this.db, {
        getRun: this.getRun.bind(this),
        profile: this.profile.bind(this),
        callsNeededToResume: this.callsNeededToResume.bind(this),
        topics: this.topics,
        assertLive: this.assertLive.bind(this),
        event: this.event.bind(this)
      })
      this.scheduling = new ContactScheduling(this.db, {
        dependencies: this.dependencies,
        profiles: this.profiles.bind(this),
        topics: this.topics,
        taskFailures: this.taskFailures,
        getRun: this.getRun.bind(this),
        heartbeatRows: this.heartbeatRows,
        profile: this.profile.bind(this),
        callCount: this.callCount.bind(this),
        scheduled: this.scheduled.bind(this),
        assertTaskBudget: this.assertTaskBudget.bind(this),
        memoryLibrary: this.memoryLibrary,
        deliveries: this.deliveries,
        handoffs: this.handoffs,
        event: this.event.bind(this),
        tokens: this.tokens,
        callsNeededToResume: this.callsNeededToResume.bind(this),
        calendars: this.calendars,
        providerRecovery: this.providerRecovery.bind(this),
        taskCallCount: this.taskCallCount.bind(this),
        assertLive: this.assertLive.bind(this),
        research: this.research.bind(this),
        saveResearch: this.saveResearch.bind(this),
        pauseForTaskBudget: this.pauseForTaskBudget.bind(this),
        fail: this.fail.bind(this),
        actions: this.actions,
        setStatus: this.setStatus.bind(this)
      })
      this.mutations = new ContactMutations(this.db, {
        heartbeatRows: this.heartbeatRows,
        profile: this.profile.bind(this),
        tokens: this.tokens,
        topics: this.topics,
        scheduled: this.scheduled.bind(this),
        research: this.research.bind(this),
        overview: this.overview.bind(this),
        materials: this.materials,
        memoryLibrary: this.memoryLibrary,
        getRun: this.getRun.bind(this),
        nextScheduledTopic: this.nextScheduledTopic.bind(this),
        startScheduledTopic: this.startScheduledTopic.bind(this),
        calendars: this.calendars,
        deliveries: this.deliveries,
        allocateTaskBudget: this.allocateTaskBudget.bind(this),
        notices: this.notices,
        handoffs: this.handoffs,
        detail: this.detail.bind(this),
        assertTaskBudget: this.assertTaskBudget.bind(this),
        callCount: this.callCount.bind(this),
        taskFailures: this.taskFailures,
        taskCallCount: this.taskCallCount.bind(this),
        createRun: this.createRun.bind(this),
        portfolio: this.portfolio,
        setTaskBudget: this.setTaskBudget.bind(this)
      })
      this.feedbackLedger = new FeedbackLedger(this)
      this.completion = new ContactCompletion(this.db, {
        dependencies: this.dependencies,
        feedbackLedger: this.feedbackLedger,
        getRun: this.getRun.bind(this),
        assertLive: this.assertLive.bind(this),
        materials: this.materials,
        portfolio: this.portfolio,
        deliveries: this.deliveries,
        research: this.research.bind(this),
        topics: this.topics,
        files: this.files,
        handoffs: this.handoffs,
        notices: this.notices,
        remember: this.remember.bind(this),
        event: this.event.bind(this),
        taskFailures: this.taskFailures,
        profile: this.profile.bind(this),
        completeCalendar: this.completeCalendar.bind(this),
        pauseForTaskBudget: this.pauseForTaskBudget.bind(this)
      })
      this.restoreFailureSchedules()
      if (version < 18) this.db.pragma('user_version = 18')
      this.dependencies.backfill()
      this.db.exec('COMMIT')
    } catch (error) {
      try { if (this.db.inTransaction) this.db.exec('ROLLBACK') } finally { this.db.close() }
      throw contactStorageFailure(error, 'tasks', 'schema')
    }
  }
  private restoreFailureSchedules(...args: Parameters<ContactStoreOperations['restoreFailureSchedules']>): ReturnType<ContactStoreOperations['restoreFailureSchedules']> { return this.scheduling.restoreFailureSchedules(...args) }
  private heartbeatRows = new Map<string, { id: number; topicId: string; at: number }>()
  recordHeartbeats(...args: Parameters<ContactStoreOperations['recordHeartbeats']>): ReturnType<ContactStoreOperations['recordHeartbeats']> { return this.scheduling.recordHeartbeats(...args) }
  close() { this.db.close() }
  pendingCleanup(...args: Parameters<ContactStoreOperations['pendingCleanup']>): ReturnType<ContactStoreOperations['pendingCleanup']> { return this.queries.pendingCleanup(...args) }
  finishCleanup(...args: Parameters<ContactStoreOperations['finishCleanup']>): ReturnType<ContactStoreOperations['finishCleanup']> { return this.mutations.finishCleanup(...args) }
  dashboard(characterIds: string[]): ReturnType<ContactStoreOperations['dashboard']> {
    // Existing interaction reconciliation stays at the command-capable facade.
    const highlights = Object.fromEntries(characterIds.filter(id => this.profile(id)).map(id => [id, cardHighlights(contactHome(this, id))]))
    return this.queries.dashboard(characterIds, highlights)
  }
  summary(...args: Parameters<ContactStoreOperations['summary']>): ReturnType<ContactStoreOperations['summary']> { return this.queries.summary(...args) }
  profile(...args: Parameters<ContactStoreOperations['profile']>): ReturnType<ContactStoreOperations['profile']> { return this.queries.profile(...args) }
  profiles(...args: Parameters<ContactStoreOperations['profiles']>): ReturnType<ContactStoreOperations['profiles']> { return this.queries.profiles(...args) }
  ensure(...args: Parameters<ContactStoreOperations['ensure']>): ReturnType<ContactStoreOperations['ensure']> { return this.mutations.ensure(...args) }
  save(...args: Parameters<ContactStoreOperations['save']>): ReturnType<ContactStoreOperations['save']> { return this.mutations.save(...args) }
  pause(...args: Parameters<ContactStoreOperations['pause']>): ReturnType<ContactStoreOperations['pause']> { return this.mutations.pause(...args) }
  cancel(...args: Parameters<ContactStoreOperations['cancel']>): ReturnType<ContactStoreOperations['cancel']> { return this.mutations.cancel(...args) }
  assertContextCurrent(...args: Parameters<ContactStoreOperations['assertContextCurrent']>): ReturnType<ContactStoreOperations['assertContextCurrent']> { return this.mutations.assertContextCurrent(...args) }
  invalidateMemory(...args: Parameters<ContactStoreOperations['invalidateMemory']>): ReturnType<ContactStoreOperations['invalidateMemory']> { return this.mutations.invalidateMemory(...args) }
  recordMaterialRead(...args: Parameters<ContactStoreOperations['recordMaterialRead']>): ReturnType<ContactStoreOperations['recordMaterialRead']> { return this.mutations.recordMaterialRead(...args) }
  recordMemoryContext(...args: Parameters<ContactStoreOperations['recordMemoryContext']>): ReturnType<ContactStoreOperations['recordMemoryContext']> { return this.mutations.recordMemoryContext(...args) }
  invalidateMaterial(...args: Parameters<ContactStoreOperations['invalidateMaterial']>): ReturnType<ContactStoreOperations['invalidateMaterial']> { return this.mutations.invalidateMaterial(...args) }
  remove(...args: Parameters<ContactStoreOperations['remove']>): ReturnType<ContactStoreOperations['remove']> { return this.mutations.remove(...args) }
  overview(...args: Parameters<ContactStoreOperations['overview']>): ReturnType<ContactStoreOperations['overview']> { return this.queries.overview(...args) }
  latestCallId(...args: Parameters<ContactStoreOperations['latestCallId']>): ReturnType<ContactStoreOperations['latestCallId']> { return this.queries.latestCallId(...args) }
  interactions(...args: Parameters<ContactStoreOperations['interactions']>): ReturnType<ContactStoreOperations['interactions']> { return this.queries.interactions(...args) }
  analytics(...args: Parameters<ContactStoreOperations['analytics']>): ReturnType<ContactStoreOperations['analytics']> { return this.queries.analytics(...args) }
  recordCallMetadata(...args: Parameters<ContactStoreOperations['recordCallMetadata']>): ReturnType<ContactStoreOperations['recordCallMetadata']> { return this.callBudget.recordCallMetadata(...args) }
  topicMetrics(...args: Parameters<ContactStoreOperations['topicMetrics']>): ReturnType<ContactStoreOperations['topicMetrics']> { return this.queries.topicMetrics(...args) }
  memories(...args: Parameters<ContactStoreOperations['memories']>): ReturnType<ContactStoreOperations['memories']> { return this.queries.memories(...args) }
  remember(...args: Parameters<ContactStoreOperations['remember']>): ReturnType<ContactStoreOperations['remember']> { return this.mutations.remember(...args) }
  forget(...args: Parameters<ContactStoreOperations['forget']>): ReturnType<ContactStoreOperations['forget']> { return this.mutations.forget(...args) }
  callCount(...args: Parameters<ContactStoreOperations['callCount']>): ReturnType<ContactStoreOperations['callCount']> { return this.callBudget.callCount(...args) }

  private runCalls(...args: Parameters<ContactStoreOperations['runCalls']>): ReturnType<ContactStoreOperations['runCalls']> { return this.callBudget.runCalls(...args) }
  private reservedCalls(...args: Parameters<ContactStoreOperations['reservedCalls']>): ReturnType<ContactStoreOperations['reservedCalls']> { return this.callBudget.reservedCalls(...args) }
  reserveRunCalls(...args: Parameters<ContactStoreOperations['reserveRunCalls']>): ReturnType<ContactStoreOperations['reserveRunCalls']> { return this.callBudget.reserveRunCalls(...args) }
  releaseRunCalls(...args: Parameters<ContactStoreOperations['releaseRunCalls']>): ReturnType<ContactStoreOperations['releaseRunCalls']> { return this.callBudget.releaseRunCalls(...args) }
  getRun(...args: Parameters<ContactStoreOperations['getRun']>): ReturnType<ContactStoreOperations['getRun']> { return this.queries.getRun(...args) }
  detail(...args: Parameters<ContactStoreOperations['detail']>): ReturnType<ContactStoreOperations['detail']> { return this.queries.detail(...args) }
  event(...args: Parameters<ContactStoreOperations['event']>): ReturnType<ContactStoreOperations['event']> { return this.mutations.event(...args) }
  taskCallCount(...args: Parameters<ContactStoreOperations['taskCallCount']>): ReturnType<ContactStoreOperations['taskCallCount']> { return this.callBudget.taskCallCount(...args) }
  resourceContext(...args: Parameters<ContactStoreOperations['resourceContext']>): ReturnType<ContactStoreOperations['resourceContext']> { return this.callBudget.resourceContext(...args) }
  assertTaskBudget(...args: Parameters<ContactStoreOperations['assertTaskBudget']>): ReturnType<ContactStoreOperations['assertTaskBudget']> { return this.callBudget.assertTaskBudget(...args) }
  setTaskBudget(...args: Parameters<ContactStoreOperations['setTaskBudget']>): ReturnType<ContactStoreOperations['setTaskBudget']> { return this.callBudget.setTaskBudget(...args) }
  allocateTaskBudget(...args: Parameters<ContactStoreOperations['allocateTaskBudget']>): ReturnType<ContactStoreOperations['allocateTaskBudget']> { return this.callBudget.allocateTaskBudget(...args) }
  createRun(...args: Parameters<ContactStoreOperations['createRun']>): ReturnType<ContactStoreOperations['createRun']> { return this.scheduling.createRun(...args) }
  assignTopic(...args: Parameters<ContactStoreOperations['assignTopic']>): ReturnType<ContactStoreOperations['assignTopic']> { return this.mutations.assignTopic(...args) }
  assignCalendarTopic(...args: Parameters<ContactStoreOperations['assignCalendarTopic']>): ReturnType<ContactStoreOperations['assignCalendarTopic']> { return this.mutations.assignCalendarTopic(...args) }
  editCalendarTopic(...args: Parameters<ContactStoreOperations['editCalendarTopic']>): ReturnType<ContactStoreOperations['editCalendarTopic']> { return this.mutations.editCalendarTopic(...args) }
  scheduled(...args: Parameters<ContactStoreOperations['scheduled']>): ReturnType<ContactStoreOperations['scheduled']> { return this.queries.scheduled(...args) }
  providerRecovery(...args: Parameters<ContactStoreOperations['providerRecovery']>): ReturnType<ContactStoreOperations['providerRecovery']> { return this.queries.providerRecovery(...args) }
  nextScheduledTopic(...args: Parameters<ContactStoreOperations['nextScheduledTopic']>): ReturnType<ContactStoreOperations['nextScheduledTopic']> { return this.scheduling.nextScheduledTopic(...args) }
  startScheduledTopic(...args: Parameters<ContactStoreOperations['startScheduledTopic']>): ReturnType<ContactStoreOperations['startScheduledTopic']> { return this.scheduling.startScheduledTopic(...args) }
  saveBrief(...args: Parameters<ContactStoreOperations['saveBrief']>): ReturnType<ContactStoreOperations['saveBrief']> { return this.mutations.saveBrief(...args) }
  saveBriefAnswer(...args: Parameters<ContactStoreOperations['saveBriefAnswer']>): ReturnType<ContactStoreOperations['saveBriefAnswer']> { return this.mutations.saveBriefAnswer(...args) }
  assertLive(...args: Parameters<ContactStoreOperations['assertLive']>): ReturnType<ContactStoreOperations['assertLive']> { return this.mutations.assertLive(...args) }
  charge(...args: Parameters<ContactStoreOperations['charge']>): ReturnType<ContactStoreOperations['charge']> { return this.callBudget.charge(...args) }
  setStatus(...args: Parameters<ContactStoreOperations['setStatus']>): ReturnType<ContactStoreOperations['setStatus']> { return this.mutations.setStatus(...args) }
  searchCount(...args: Parameters<ContactStoreOperations['searchCount']>): ReturnType<ContactStoreOperations['searchCount']> { return this.callBudget.searchCount(...args) }
  chargeSearch(...args: Parameters<ContactStoreOperations['chargeSearch']>): ReturnType<ContactStoreOperations['chargeSearch']> { return this.callBudget.chargeSearch(...args) }
  research(...args: Parameters<ContactStoreOperations['research']>): ReturnType<ContactStoreOperations['research']> { return this.queries.research(...args) }
  saveResearch(...args: Parameters<ContactStoreOperations['saveResearch']>): ReturnType<ContactStoreOperations['saveResearch']> { return this.mutations.saveResearch(...args) }
  defer(...args: Parameters<ContactStoreOperations['defer']>): ReturnType<ContactStoreOperations['defer']> { return this.scheduling.defer(...args) }
  recoverOutOfScopeQuestion(...args: Parameters<ContactStoreOperations['recoverOutOfScopeQuestion']>): ReturnType<ContactStoreOperations['recoverOutOfScopeQuestion']> { return this.scheduling.recoverOutOfScopeQuestion(...args) }
  recover(...args: Parameters<ContactStoreOperations['recover']>): ReturnType<ContactStoreOperations['recover']> { return this.scheduling.recover(...args) }
  runnable(...args: Parameters<ContactStoreOperations['runnable']>): ReturnType<ContactStoreOperations['runnable']> { return this.queries.runnable(...args) }
  callsNeededToResume(...args: Parameters<ContactStoreOperations['callsNeededToResume']>): ReturnType<ContactStoreOperations['callsNeededToResume']> { return this.queries.callsNeededToResume(...args) }
  wait(...args: Parameters<ContactStoreOperations['wait']>): ReturnType<ContactStoreOperations['wait']> { return this.mutations.wait(...args) }
  answer(...args: Parameters<ContactStoreOperations['answer']>): ReturnType<ContactStoreOperations['answer']> { return this.mutations.answer(...args) }
  fail(...args: Parameters<ContactStoreOperations['fail']>): ReturnType<ContactStoreOperations['fail']> { return this.mutations.fail(...args) }
  private failRun(...args: Parameters<ContactStoreOperations['failRun']>): ReturnType<ContactStoreOperations['failRun']> { return this.mutations.failRun(...args) }
  finish(...args: Parameters<ContactStoreOperations['finish']>): ReturnType<ContactStoreOperations['finish']> { return this.completion.finish(...args) }
  createTopic(...args: Parameters<ContactStoreOperations['createTopic']>): ReturnType<ContactStoreOperations['createTopic']> { return this.mutations.createTopic(...args) }
  private completeCalendar(...args: Parameters<ContactStoreOperations['completeCalendar']>): ReturnType<ContactStoreOperations['completeCalendar']> { return this.scheduling.completeCalendar(...args) }
  private pauseForTaskBudget(...args: Parameters<ContactStoreOperations['pauseForTaskBudget']>): ReturnType<ContactStoreOperations['pauseForTaskBudget']> { return this.mutations.pauseForTaskBudget(...args) }
  deleteTopic(...args: Parameters<ContactStoreOperations['deleteTopic']>): ReturnType<ContactStoreOperations['deleteTopic']> { return this.mutations.deleteTopic(...args) }
  revisePresentation(...args: Parameters<ContactStoreOperations['revisePresentation']>): ReturnType<ContactStoreOperations['revisePresentation']> { return this.mutations.revisePresentation(...args) }
  reviseCitation(...args: Parameters<ContactStoreOperations['reviseCitation']>): ReturnType<ContactStoreOperations['reviseCitation']> { return this.mutations.reviseCitation(...args) }
  reviseTopic(...args: Parameters<ContactStoreOperations['reviseTopic']>): ReturnType<ContactStoreOperations['reviseTopic']> { return this.mutations.reviseTopic(...args) }
  editTaskFromChat(...args: Parameters<ContactStoreOperations['editTaskFromChat']>): ReturnType<ContactStoreOperations['editTaskFromChat']> { return this.mutations.editTaskFromChat(...args) }
  changeTopic(...args: Parameters<ContactStoreOperations['changeTopic']>): ReturnType<ContactStoreOperations['changeTopic']> { return this.mutations.changeTopic(...args) }
  focusTopic(...args: Parameters<ContactStoreOperations['focusTopic']>): ReturnType<ContactStoreOperations['focusTopic']> { return this.mutations.focusTopic(...args) }
  continueTopic(...args: Parameters<ContactStoreOperations['continueTopic']>): ReturnType<ContactStoreOperations['continueTopic']> { return this.mutations.continueTopic(...args) }
}
