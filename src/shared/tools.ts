export type ToolRisk = 'safe' | 'read' | 'write'
export type ToolPermissionMode = 'confirm' | 'auto' | 'full'
export type ToolSource = 'builtin' | 'plugin'
export type ToolExecutionStatus = 'requested' | 'running' | 'completed' | 'denied' | 'error'

export interface ToolJsonSchema {
  type: 'object'
  properties: Record<string, {
    type: 'string' | 'number' | 'boolean'
    description?: string
    maxLength?: number
  }>
  required?: string[]
  additionalProperties?: boolean
}

export interface AIToolDefinition {
  name: string
  displayName: string
  description: string
  inputSchema: ToolJsonSchema
  risk: ToolRisk
  requiresConfirmation: boolean
  source: ToolSource
}

export interface ToolCatalogItem extends AIToolDefinition {
  enabled: boolean
}

export interface AIToolCall {
  id: string
  name: string
  arguments: string
}

export interface ToolApprovalRequest {
  requestId: string
  approvalId: string
  callId: string
  name: string
  displayName: string
  description: string
  risk: ToolRisk
  arguments: Record<string, unknown>
}

export interface ToolExecutionEvent {
  requestId: string
  callId: string
  name: string
  displayName: string
  risk: ToolRisk
  status: ToolExecutionStatus
  summary?: string
}

export interface ToolApprovalResolution {
  approvalId: string
  approved: boolean
}

export interface ToolActivityData {
  callId: string
  name: string
  displayName: string
  risk: ToolRisk
  status: ToolExecutionStatus
  summary?: string
}

export function parseToolArguments(value: string): Record<string, unknown> {
  if (!value.trim()) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function getToolRiskLabel(risk: ToolRisk): string {
  if (risk === 'write') return '将修改本机内容'
  if (risk === 'read') return '将读取本机内容'
  return '无副作用操作'
}

export function shouldConfirmTool(
  definition: Pick<AIToolDefinition, 'risk' | 'requiresConfirmation'>,
  mode: ToolPermissionMode
): boolean {
  if (mode === 'full') return false
  if (mode === 'auto') return definition.risk === 'write'
  return definition.requiresConfirmation
}

export function validateToolArguments(
  schema: ToolJsonSchema,
  arguments_: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const required of schema.required || []) {
    if (!(required in arguments_)) throw new Error(`缺少工具参数：${required}`)
  }
  for (const [key, value] of Object.entries(arguments_)) {
    const property = schema.properties[key]
    if (!property) {
      if (schema.additionalProperties === false) continue
      result[key] = value
      continue
    }
    if (typeof value !== property.type) throw new Error(`工具参数 ${key} 类型无效`)
    result[key] = typeof value === 'string' && property.maxLength ? value.slice(0, property.maxLength) : value
  }
  return result
}
