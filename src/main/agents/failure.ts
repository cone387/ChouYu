import { contactFailure } from '../../shared/contact-failure'
import { containsSecret } from '../../shared/memory'

/** Persist a useful cause without copying provider credentials or private endpoints. */
export function safeAgentFailure(error: unknown): string {
  const fallback = '执行失败，请检查模型配置和资料来源后重试。'
  if (!(error instanceof Error)) return fallback
  const message = error.message
  if (!containsSecret(message) && !/https?:|key|token|authorization/i.test(message)) return message
  // Classification sees the original cause; storage receives only fixed, credential-free text.
  switch (contactFailure(message).kind) {
    case 'billing': return '模型服务商余额不足或没有可用资源包，请补充服务商额度或更换模型服务。'
    case 'configuration': return '模型服务的密钥、权限或模型配置不可用，请检查该联系人的模型设置。'
    case 'network': return '模型服务发生网络、超时或限流错误，请稍后重试。'
    default: return fallback
  }
}
