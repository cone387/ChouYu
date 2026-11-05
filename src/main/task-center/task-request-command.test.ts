import { afterEach, expect, it } from 'vitest'
import { ContactTaskCommands } from './commands'
import { ContactTaskStore } from './contact-store'
import { createContactTools } from '../agents/tools'
import { createDeliveryFeedbackTools } from '../agents/delivery-feedback'
import type { ToolExecutionContext } from '../tools/registry'

const stores: ContactTaskStore[] = []
afterEach(() => stores.splice(0).forEach(store => store.close()))
function fixture() {
  const store = new ContactTaskStore(':memory:'); stores.push(store); store.ensure('alice')
  const topic = store.topics.create('alice', { title: '文章', goal: '写文章', constraints: '保留依据' })
  let aborted = 0
  const commands = new ContactTaskCommands({ store, identity: id => ({ id, conversation: '', config: {} } as never), changed() {}, tick() {}, remove: async () => {}, activeFor: () => [], abort: () => { aborted++ }, activeRun: () => undefined, cleanupThread: async () => {} })
  const tools = createContactTools({ owner: () => 'alice', dispatchUnknown: (method, owner, args) => commands.dispatchUnknown(method, owner, args) })
  const args = { topicId: topic.id, revision: topic.revision, constraints: '保留依据，增加案例', reason: '模型概括' }
  const source = { requestId: 'user-request', sessionId: 'session', messageId: 'message', text: '保留所有依据，再增加一个实际案例', acceptedAt: 100 }
  const context = { sessionId: 'session', taskRequest: source } as ToolExecutionContext
  return { store, topic, commands, tool: tools.find(tool => tool.name === 'edit_contact_task')!, args, source, context, aborted: () => aborted }
}

it('records host original text through the real tool and command and replays before stale preflight', async () => {
  const f = fixture()
  const prepared = await f.tool.prepareAsync!(f.args, f.context)
  await prepared.execute()
  const record = f.store.requests.list('alice', f.topic.id).items[0]
  expect(record?.source.text).toBe('保留所有依据，再增加一个实际案例')
  expect(record?.source.messageId).toBe('message')
  const revision = f.store.topics.get('alice', f.topic.id).revision
  const replay = await f.tool.prepareAsync!(f.args, f.context)
  expect(replay.noOpResult?.content).toContain('saved')
  expect(f.store.topics.get('alice', f.topic.id).revision).toBe(revision)
  expect(f.aborted()).toBe(1)
  await expect(f.tool.prepareAsync!({ ...f.args, constraints: '不同要求' }, f.context)).rejects.toThrow('请求')
})

it('tracks a chat answer to a persistent question atomically and does not answer it twice', async () => {
  const f = fixture(), runId = f.store.createRun('alice', '', Date.now(), f.topic.id)
  f.store.wait(runId, '读者年龄？')
  const card = f.store.decisions.pending('alice').find(row => row.kind === 'question')!
  const source = { ...f.source, text: '写给十岁的小朋友，保留解释' }, response = { version: card.version, answer: source.text }
  f.store.db.exec("CREATE TRIGGER answer_request_failure BEFORE INSERT ON contact_task_requests BEGIN SELECT RAISE(ABORT, 'answer request failed'); END")
  await expect(f.commands.dispatchUnknown('answerInteractionRequest', 'alice', [card.id, response, source])).rejects.toThrow('answer request failed')
  expect(f.store.getRun(runId)?.status).toBe('waiting')
  expect(f.store.decisions.get('alice', card.id).status).toBe('pending')
  f.store.db.exec('DROP TRIGGER answer_request_failure')
  await f.commands.dispatchUnknown('answerInteractionRequest', 'alice', [card.id, response, source])
  await f.commands.dispatchUnknown('answerInteractionRequest', 'alice', [card.id, response, source])
  expect(f.store.requests.list('alice', f.topic.id).items).toMatchObject([{ effect: 'answer', source: { text: source.text }, attempts: [{ runId }] }])
  expect(f.store.db.prepare("SELECT COUNT(*) AS n FROM events WHERE run_id=? AND kind='answer'").get(runId)).toEqual({ n: 1 })
})


it('rolls back a command and avoids aborting an active worker when ledger persistence fails', async () => {
  const f = fixture(), prepared = await f.tool.prepareAsync!(f.args, f.context)
  f.store.db.exec("CREATE TRIGGER request_failure BEFORE INSERT ON contact_task_requests BEGIN SELECT RAISE(ABORT, 'request persistence failed'); END")
  await expect(prepared.execute()).rejects.toThrow('request persistence failed')
  expect(f.store.topics.get('alice', f.topic.id)).toEqual(f.topic)
  expect(f.aborted()).toBe(0)
})

it('links formal delivery revisions to the same original message ledger and keeps their existing feedback receipts', async () => {
  const f = fixture(), runId = f.store.createRun('alice', '', Date.now(), f.topic.id)
  f.store.finish(runId, { runId, title: '正文', body: '已保存', nextStep: '继续', evidence: [], createdAt: Date.now() }, [],
    { status: 'researching', judgement: '已保存', openQuestions: '', nextStep: '继续', reason: '提交' },
    { completionCriteria: '完成', stages: [{ id: 'write', title: '写作', status: 'active' }], summary: '正文', section: { id: 'p', title: '正文', body: '原文' } })
  const tool = createDeliveryFeedbackTools({ owner: () => 'alice', dispatchUnknown: (method, owner, args) => f.commands.dispatchUnknown(method, owner, args) })[0]
  const args = { topicId: f.topic.id, revision: f.store.topics.get('alice', f.topic.id).revision, deliveryVersion: 1, action: 'revise', reason: '增加案例' }
  await (await tool.prepareAsync!(args, f.context)).execute()
  const row = f.store.requests.list('alice', f.topic.id).items[0]
  expect(row).toMatchObject({ source: { text: f.source.text }, effect: 'revision', status: 'queued' })
  expect(row.attempts[0].runId).toBe(f.store.feedbackLedger.list('alice', f.topic.id)[0].runId)
  expect((await tool.prepareAsync!(args, f.context)).noOpResult).toBeDefined()
  expect(f.store.feedbackLedger.list('alice', f.topic.id)).toHaveLength(1)
})
