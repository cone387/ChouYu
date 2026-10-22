import { randomUUID } from 'node:crypto'
import type { AIToolCall, ToolApprovalRequest } from '../../shared/tools'
import { parseToolArguments } from '../../shared/tools'
import { getRegisteredTool } from '../tools/registry'
import { waitForToolApproval, type ToolApprovalOutcome } from '../tool-approval'
import type { ChatSender } from './service'

/** A confirmation belongs to the requesting renderer and remains live while hidden. */
export class ChatToolApprovals {
  private pending = new Map<string, { senderId: number; resolve: (approved: boolean) => void }>()

  request(sender: ChatSender, requestId: string, call: AIToolCall, signal: AbortSignal, preview?: string): Promise<ToolApprovalOutcome> {
    const definition = getRegisteredTool(call.name)
    if (!definition) throw new Error('工具已不可用。')
    if (sender.isDestroyed()) return Promise.resolve('cancelled')
    const approvalId = randomUUID()
    const request: ToolApprovalRequest = { preview, requestId, approvalId, callId: call.id,
      name: definition.name, displayName: definition.displayName, description: definition.description,
      risk: definition.risk, arguments: parseToolArguments(call.arguments) }
    return waitForToolApproval(signal, resolve => {
      this.pending.set(approvalId, { senderId: sender.id, resolve })
      try { sender.send('ai:tool-approval-request', request) }
      catch (error) { this.pending.delete(approvalId); throw error }
      return () => { this.pending.delete(approvalId) }
    })
  }

  resolve(senderId: number, approvalId: string, approved: boolean): void {
    const pending = this.pending.get(approvalId)
    if (pending?.senderId === senderId) pending.resolve(approved)
  }
}
