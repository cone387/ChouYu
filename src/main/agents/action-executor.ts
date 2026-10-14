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
  start(version: string): Promise<unknown>
  prepare(option: ContactActionOption, sessionId: string, credential?: string): Promise<PreparedTool>
}
/** Only saved options reach the registry. Renderer/model submissions cannot replace their tool or arguments. */
export async function executeContactAction(access: ContactActionExecution, submission: ContactInteractionSubmission) {
  const existing = await access.read()
  if (existing.status === 'resolved') return existing
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
  return access.finish(card.version, result)
}
