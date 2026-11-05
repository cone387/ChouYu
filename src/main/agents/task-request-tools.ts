import type { ContactRequest } from '../../shared/contact-commands'
import type { RegisteredTool } from '../tools/registry'
import { taskRequestPayload, TRACKED_TASK_TOOLS } from '../../shared/contact-task-requests'

/** Resolve a persisted receipt before ordinary stale-version preflight, never execute it again. */
export function withTaskRequestReplay(tool: RegisteredTool, request: ContactRequest, owner: (sessionId?: string) => string | undefined): RegisteredTool {
  if (!TRACKED_TASK_TOOLS.has(tool.name) || !tool.prepareAsync) return tool
  const prepare = tool.prepareAsync
  return { ...tool, async prepareAsync(args, context) {
    if (context.taskRequest) {
      const id = owner(context.sessionId)
      if (!id || context.taskRequest.sessionId !== context.sessionId) throw new Error('任务请求会话归属无效。')
      const submission = { source: context.taskRequest, tool: tool.name, arguments: args }
      taskRequestPayload(submission)
      const receipt = await request('getTaskRequest', id, [submission])
      if (receipt) {
        const message = receipt.topicId ? '该请求此前已保存，本次未重复执行；保存要求不代表工作完成，请查看任务请求记录。' : '该请求对应的任务已删除，本次未重复执行。'
        const result = { content: JSON.stringify({ saved: true, receipt, workCompleted: false, message }), summary: message }
        return { noOpResult: result, execute: () => result }
      }
    }
    return prepare(args, context)
  } }
}
