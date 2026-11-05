// Cross-process integration lives outside node/web TS projects; both production sides are checked separately.
import { afterEach, expect, it, vi } from 'vitest'
import { ContactTaskCommands } from '../main/task-center/commands'
import { ContactTaskStore } from '../main/task-center/contact-store'
import { createContactTools } from '../main/agents/tools'
import type { ToolExecutionContext } from '../main/tools/registry'
import type { Message } from '../shared/conversations'
import { streamChat } from '../renderer/src/core/ai-engine'
import { getConversationForRetry, getEditedConversation } from '../renderer/src/core/conversation-actions'
import { buildMessages } from '../renderer/src/core/prompt-builder'
import { parseAIStreamRequest } from '../main/chat/request'
import { chatTaskRequestSource } from '../main/chat/task-request-source'
import { DEFAULT_APP_CONFIG } from '../shared/config'

const stores: ContactTaskStore[] = []
afterEach(() => stores.splice(0).forEach(store => store.close()))
function fixture() {
  const store = new ContactTaskStore(':memory:'); stores.push(store); store.ensure('alice')
  store.topics.create('alice', { title: 'existing', goal: 'existing work', constraints: '' })
  const commands = new ContactTaskCommands({ store, identity: id => ({ id, conversation: '', config: {} } as never), changed() {}, tick() {}, remove: async () => {}, activeFor: () => [], abort() {}, activeRun: () => undefined, cleanupThread: async () => {} })
  return { store, commands }
}

it('keeps renderer retries of one user message idempotent across new stream IDs, but accepts edited and new messages', async () => {
  const f = fixture(), tools = createContactTools({ owner: () => 'alice', dispatchUnknown: (method, owner, args) => f.commands.dispatchUnknown(method, owner, args) })
  const tool = tools.find(item => item.name === 'assign_contact_task')!
  const user = { id: 'stable-user', role: 'user' as const, content: '写一篇文章', timestamp: 100 }
  const conversation = [user, { id: 'failed-reply', role: 'assistant' as const, content: '回复失败', timestamp: 101 }]
  const streamIds: string[] = [], sources: string[] = []
  vi.stubGlobal('window', { electronAPI: { ai: { onStreamEvent: () => () => {}, cancelStream() {}, startStream: async (raw: unknown) => {
    const request = parseAIStreamRequest(raw)!
    streamIds.push(request.requestId)
    const source = chatTaskRequestSource(request, conversation, Date.now())!
    sources.push(source.requestId)
    await (await tool.prepareAsync!({ description: request.messages.at(-1)!.content }, { sessionId: 'session', taskRequest: source } as ToolExecutionContext)).execute()
    return { ok: false, error: 'final response failed after saving' }
  } } } })
  const send = (messages: Message[]) => streamChat(buildMessages(messages), '', DEFAULT_APP_CONFIG, () => {}, undefined, undefined, 'alice', 'session').catch(() => {})
  try {
    await send([user]); await send(getConversationForRetry(conversation, 'failed-reply')!)
    expect(streamIds[0]).not.toBe(streamIds[1])
    expect(sources[0]).toBe(sources[1])
    expect(f.store.topics.list('alice')).toHaveLength(2)
    await send([...conversation.slice(0, 1), { ...conversation[1], responseStatus: 'stopped' }])
    expect(sources[2]).toBe(sources[0])
    expect(f.store.topics.list('alice')).toHaveLength(2)
    const edited = getEditedConversation(conversation, user.id, '写一篇新的文章')!
    await send(edited)
    await send(getEditedConversation(edited, user.id, user.content)!)
    await send([{ ...user, id: 'separately-sent' }])
    expect(new Set(sources).size).toBe(4)
    expect(f.store.topics.list('alice')).toHaveLength(5)
  } finally { vi.unstubAllGlobals() }
})
