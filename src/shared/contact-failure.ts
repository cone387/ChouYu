import type { ContactInteraction } from './contact-interactions'
export function contactFailure(error: string): NonNullable<ContactInteraction['failure']> {
  // The repair wrapper describes the attempt, not the underlying cause or remedy.
  error = error.replace(/^工作计划自动修复后仍未通过校验：/, '').trim()
  if (/工具调用次数超过安全上限/.test(error)) return { kind: 'tool-limit', message: '模型连续调用工具，达到单次请求的安全上限后仍未返回可交付结果，本次工作已停止。可以重试；反复出现时请检查当前联系人启用的技能是否适合这项任务。已有正文保留。', action: '重新尝试', settings: true, settingsTarget: 'skills' }
  if (/工作计划不是完整、唯一的 JSON|工作计划返回为空/.test(error)) return { kind: 'format', message: '模型未按要求返回完整的工作计划，尚未开始本轮资料读取或正文写作。自动修正也未能获得有效计划，可以重新生成计划后继续。', action: '重新生成计划并继续', settings: false }
  if (/下次检查间隔无效/.test(error)) return { kind: 'format', message: '模型返回的下一次检查间隔无效，工作计划未能执行。已有正文保留，可以重新生成计划后继续。', action: '重新生成计划并继续', settings: false }
  if (/工具.*(?:关闭|禁用)/.test(error)) return { kind: 'permission', message: '任务需要的工具已关闭。请在系统工具设置中启用所需工具后重试；联系人自动执行策略不会开启被关闭的工具。', action: '已处理，重试本任务', settings: true }
  if (/搜索失败|Brave.*(?:HTTP|失败)/i.test(error)) return { kind: 'source', message: /429|限流|rate.?limit/i.test(error)
    ? '搜索服务请求受限或搜索额度不足。可以稍后重试，或在这个联系人的工作设置中检查搜索服务额度。'
    : /401|403|unauthorized|authentication/i.test(error) ? '搜索服务的密钥或额度不可用。请在这个联系人的工作设置中检查搜索密钥及服务额度。'
    : '搜索服务暂时不可用。可以稍后重试，或在这个联系人的工作设置中检查搜索配置。', action: '重试本任务', settings: true, settingsTarget: 'work' }
  if (/工作计划.*(?:urls|格式|JSON)|工作计划.*修复/.test(error)) return { kind: 'format', message: '下一步工作计划中的资料地址或参数格式不正确，尚未执行这份计划。系统未能在本轮完成自动修正，可以重新尝试；无需为格式错误开放权限。', action: '重新生成计划并继续', settings: false }
  if (/研究计划包含当前权限不允许读取的网页/.test(error)) return { kind: 'source', message: '资料地址未通过检查。这条旧记录没有区分地址格式和访问范围问题，不能直接判断为权限不足；可以重新生成计划，或核对网页访问范围。', action: '重新尝试', settings: true, settingsTarget: 'work' }
  if (/Docker|容器|技能.*(?:脚本|依赖|授权|禁用|启用)|脚本.*权限|依赖.*(?:未|缺少|失败)/i.test(error)) return { kind: 'skill', message: '技能运行环境、依赖或脚本授权不可用。请到这个联系人的技能页检查运行环境、准备依赖或启用所需脚本；已有成果保留。', action: '已处理，重试本任务', settings: true, settingsTarget: 'skills' }
  if (/网页访问权限|不允许自主搜索|未授权读取联系人|搜索密钥|Brave Search API Key|权限.*(?:读取|搜索)|工具.*(?:关闭|禁用)/i.test(error)) return { kind: 'permission', message: /共享成果/.test(error) ? '当前未允许读取其他联系人共享的成果。可以在工作设置中授权后重试，或调整任务要求。'
    : /搜索|Brave/i.test(error) ? '当前搜索不可用。请在工作设置中检查搜索开关、搜索密钥和网页访问范围，或让任务仅使用现有资料。'
    : /工具/.test(error) ? '任务需要的工具已关闭。请在系统工具设置中启用所需工具后重试；联系人自动执行策略不会开启被关闭的工具。'
    : '计划读取的网页超出已授权的访问范围。请核对工作设置中的允许网页，或调整任务使用的资料。', action: '已处理，重试本任务', settings: true, ...(!/工具/.test(error) ? { settingsTarget: 'work' as const } : {}) }
  if (/余额不足|无可用资源包|insufficient[_ ]quota|credit.*exhaust|billing|payment required/i.test(error)) return { kind: 'billing', message: '模型服务商的余额或资源包不足。请先在服务商处补充额度，或在模型设置中更换可用服务。任务内加额度不能解决这个问题。', action: '已处理，重试本任务', settings: true }
  if (/401|403|api.?key|密钥|unauthorized|authentication|model.*not found|模型.*不存在/i.test(error)) return { kind: 'configuration', message: '模型服务的密钥、权限或模型配置不可用。请检查该联系人使用的模型服务，修改后再重试。', action: '已检查，重试本任务', settings: true }
  if (/429|rate.?limit|超时|timeout|network|网络|ECONN|fetch failed|502|503|504/i.test(error)) return { kind: 'network', message: '模型服务暂时无法连接或请求受限。已有成果保留，可以稍后重试。', action: '重试本任务', settings: false }
  if (/格式|校验|字段|JSON|parse|schema/i.test(error)) return { kind: 'format', message: '这次返回的成果没有通过格式校验，未作为新成果保存。可以重新尝试；反复出现时请查看工作记录。', action: '重新尝试', settings: false }
  return { kind: 'unknown', message: '这次工作没有完成，已有成果保留。可查看任务中的工作记录了解原因，再决定是否重试。', action: '重试本任务', settings: false }
}

/** Bounded cadence, not a balance API: the next real task attempt probes availability. */
export function providerRecoveryDelay(error: string, failures: number, intervalMinutes = 0): number | undefined {
  if (failures < 3 || !['billing', 'network'].includes(contactFailure(error).kind)) return
  return Math.max(Math.min(60, 15 * 2 ** Math.min(2, failures - 3)), intervalMinutes) * 60000
}
