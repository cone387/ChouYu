import type { ContactInteraction } from './contact-interactions'
export function contactFailure(error: string): NonNullable<ContactInteraction['failure']> {
  if (/余额不足|无可用资源包|insufficient[_ ]quota|credit.*exhaust|billing|payment required/i.test(error)) return { kind: 'billing', message: '模型服务商的余额或资源包不足。请先在服务商处补充额度，或在模型设置中更换可用服务。任务内加额度不能解决这个问题。', action: '已处理，重试本任务', settings: true }
  if (/401|403|api.?key|密钥|unauthorized|authentication|model.*not found|模型.*不存在/i.test(error)) return { kind: 'configuration', message: '模型服务的密钥、权限或模型配置不可用。请检查该联系人使用的模型服务，修改后再重试。', action: '已检查，重试本任务', settings: true }
  if (/429|rate.?limit|超时|timeout|network|网络|ECONN|fetch failed|502|503|504/i.test(error)) return { kind: 'network', message: '模型服务暂时无法连接或请求受限。已有成果保留，可以稍后重试。', action: '重试本任务', settings: false }
  if (/格式|校验|字段|JSON|parse|schema/i.test(error)) return { kind: 'format', message: '这次返回的成果没有通过格式校验，未作为新成果保存。可以重新尝试；反复出现时请查看工作记录。', action: '重新尝试', settings: false }
  return { kind: 'unknown', message: '这次工作没有完成，已有成果保留。可查看任务中的工作记录了解原因，再决定是否重试。', action: '重试本任务', settings: false }
}
