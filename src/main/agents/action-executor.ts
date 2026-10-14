import type { ContactActionInteraction, ContactActionOption, ContactActionOutcome, ContactActionResponse } from '../../shared/contact-actions'
import type { ContactInteractionSubmission } from '../../shared/contact-interactions'
import type { PreparedTool } from '../tools/registry'
import { contactActionCredential } from '../../shared/contact-actions'

export interface ContactActionExecution {
  read(): Promise<ContactActionInteraction>
  claim(version: string, response: ContactActionResponse): Promise<ContactActionInteraction>
  finish(version: string, result: ContactActionOutcome): Promise<ContactActionInteraction>
  fail(version: string, message: string): Promise<ContactActionInteraction>
  reject(version: string): Promise<ContactActionInteraction>
  acknowledge?(version: string): Promise<ContactActionInteraction>
  start(version: string): Promise<unknown>
  prepare(option: ContactActionOption, sessionId: string, credential?: string): Promise<PreparedTool>
}
/** Only saved options reach the registry. Renderer/model submissions cannot replace their tool or arguments. */
export async function executeContactAction(access: ContactActionExecution, submission: ContactInteractionSubmission) {
  const existing = await access.read()
  if (existing.status === 'resolved') return existing
  if (submission.acknowledge === true) {
    if (!access.acknowledge || submission.reject || submission.actionId || submission.text || submission.credential) throw new Error('核对操作不能同时执行其他动作。')
    return access.acknowledge(submission.version)
  }
  if (submission.reject === true) return access.reject(submission.version)
  const credential = contactActionCredential(existing.request, submission)
  const card = await access.claim(submission.version, { actionId: submission.actionId!, ...(submission.text === undefined ? {} : { text: submission.text }) })
  if (card.status === 'resolved') return card
  let result: ContactActionOutcome
  try {
    const option = card.request.actions.find(a => a.id === card.response?.actionId)!
    const arguments_ = { ...option.arguments, ...(card.request.input && card.response?.text !== undefined ? { [card.request.input.argument]: card.response.text } : {}) }
    const prepared = await access.prepare({ ...option, arguments: arguments_ }, card.request.sessionId, credential)
    if (!prepared.noOpResult) await access.start(card.version)
    result = prepared.noOpResult ?? await prepared.execute()
  } catch (error) {
    return access.fail(card.version, error instanceof Error ? error.message : '操作失败，请重新读取后重试。')
  }
  // A receipt-write failure must not be mistaken for an execution failure that is safe to repeat.
  try { return await access.finish(card.version, result) }
  catch {
    // The durable start marker makes this non-retryable even when the operation itself succeeded.
    // If storage is still unavailable, leave that marker for restart recovery rather than replaying.
    return access.fail(card.version, '操作已执行，但保存结果回执失败；请核对当前状态，不能据此重复执行。')
  }
}
