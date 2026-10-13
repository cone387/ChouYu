import type { ContactInteraction } from './contact-interactions'
function classifyFailure(error: string): NonNullable<ContactInteraction['failure']> {
  // The repair wrapper describes the attempt, not the underlying cause or remedy.
  error = error.replace(/^工作计划自动修复后仍未通过校验：/, '').trim()
  if (/无法可靠核对任务结束条件/.test(error)) return { kind: 'format', title: '任务结束条件尚未确认', message: '未能确认原要求是否已经完成，因此没有把任务标为结束。需要重新核对已交付内容后再继续。', action: '重新核对并继续', settings: false }
  if (/资料不在本轮目录快照/.test(error)) return { kind: 'material', title: '资料引用需要纠正', message: '读取参考资料时中断：请求的资料或版本不在本次可用目录中。需要按目录重新选择资料后继续。', action: '重新尝试', settings: false }
  if (/资料.*(?:撤回|移除|版本不存在|不在本次任务范围|不属于)|参考资料.*(?:变化|删除)/.test(error)) return { kind: 'material', title: '参考资料已不可用', message: '这次需要的资料已撤回、移除或不在当前任务范围内。请在任务的资料页核对可用资料后继续。', action: '已检查资料，重试', settings: false }
  if (/章节收尾|章节.*(?:推进|衔接|顺序)/.test(error)) return { kind: 'chapter', message: '未能确认这一章该继续写、收尾还是进入下一章，因此停止了这次续写，避免接错章节。', action: '重新尝试续写', settings: false }
  if (/参考记忆.*(?:纠正|忘记)|上下文.*失效/.test(error)) return { kind: 'context', message: '参考记忆已更新或被忘记，这次尝试已停止，避免继续使用旧内容。再次执行会重新读取有效记忆。', action: '按最新记忆继续', settings: false }
  if (/SQLITE_FULL|SQLITE_IOERR|SQLITE_READONLY|ENOSPC|磁盘.*(?:满|不足)|database.*(?:locked|disk|readonly)/i.test(error)) return { kind: 'storage', message: '本地存储写入失败，无法确认这次结果已保存。请检查磁盘空间和数据目录是否可写，再重试。', action: '已检查存储，重试', settings: false }
  if (/分段恢复次数|进度信息恢复|临时正文已达|恢复未生成有效正文|输出.*(?:截断|过长)/.test(error)) return { kind: 'output', message: '这次正文生成或恢复没有完成，尚不能作为完整的新成果交付。', action: '继续尝试生成', settings: false }
  if (/工具调用次数超过安全上限/.test(error)) return { kind: 'tool-limit', message: '模型连续调用工具，达到单次请求的安全上限后仍未返回可交付结果，这次尝试已停止。反复出现时请检查启用的技能是否适合这项任务。', action: '重新尝试', settings: true, settingsTarget: 'skills' }
  if (/工作计划不是完整、唯一的 JSON|工作计划返回为空/.test(error)) return { kind: 'format', message: '模型未按要求返回完整的工作计划，尚未开始本轮资料读取或正文写作。自动修正也未能获得有效计划，可以重新生成计划后继续。', action: '重新生成计划并继续', settings: false }
  if (/下次检查间隔无效/.test(error)) return { kind: 'format', message: '模型返回的下一次检查间隔无效，工作计划未能执行。需要重新生成计划后继续。', action: '重新生成计划并继续', settings: false }
  if (/工具.*(?:关闭|禁用)/.test(error)) return { kind: 'permission', message: '任务需要的工具已关闭。请在系统工具设置中启用所需工具后重试；联系人自动执行策略不会开启被关闭的工具。', action: '已处理，重试本任务', settings: true }
  if (/搜索失败|Brave.*(?:HTTP|失败)/i.test(error)) return { kind: 'source', message: /429|限流|rate.?limit/i.test(error)
    ? '搜索服务请求受限或搜索额度不足。可以稍后重试，或在这个联系人的工作设置中检查搜索服务额度。'
    : /401|403|unauthorized|authentication/i.test(error) ? '搜索服务的密钥或额度不可用。请在这个联系人的工作设置中检查搜索密钥及服务额度。'
    : '搜索服务暂时不可用。可以稍后重试，或在这个联系人的工作设置中检查搜索配置。', action: '重试本任务', settings: true, settingsTarget: 'work' }
  if (/工作计划.*(?:urls|格式|JSON)|工作计划.*修复/.test(error)) return { kind: 'format', message: '下一步工作计划中的资料地址或参数格式不正确，尚未执行这份计划。系统未能在本轮完成自动修正，可以重新尝试；无需为格式错误开放权限。', action: '重新生成计划并继续', settings: false }
  if (/研究计划包含当前权限不允许读取的网页/.test(error)) return { kind: 'source', message: '资料地址未通过检查。这条旧记录没有区分地址格式和访问范围问题，不能直接判断为权限不足；可以重新生成计划，或核对网页访问范围。', action: '重新尝试', settings: true, settingsTarget: 'work' }
  if (/Docker|容器|技能.*(?:脚本|依赖|授权|禁用|启用)|脚本.*权限|依赖.*(?:未|缺少|失败)/i.test(error)) return { kind: 'skill', message: '技能运行环境、依赖或脚本授权不可用。请到这个联系人的技能页检查运行环境、准备依赖或启用所需脚本。', action: '已处理，重试本任务', settings: true, settingsTarget: 'skills' }
  if (/网页访问权限|不允许自主搜索|未授权读取联系人|搜索密钥|Brave Search API Key|权限.*(?:读取|搜索)|工具.*(?:关闭|禁用)/i.test(error)) return { kind: 'permission', message: /共享成果/.test(error) ? '当前未允许读取其他联系人共享的成果。可以在工作设置中授权后重试，或调整任务要求。'
    : /搜索|Brave/i.test(error) ? '当前搜索不可用。请在工作设置中检查搜索开关、搜索密钥和网页访问范围，或让任务仅使用现有资料。'
    : /工具/.test(error) ? '任务需要的工具已关闭。请在系统工具设置中启用所需工具后重试；联系人自动执行策略不会开启被关闭的工具。'
    : '计划读取的网页超出已授权的访问范围。请核对工作设置中的允许网页，或调整任务使用的资料。', action: '已处理，重试本任务', settings: true, ...(!/工具/.test(error) ? { settingsTarget: 'work' as const } : {}) }
  if (/余额不足|无可用资源包|insufficient[_ ]quota|credit.*exhaust|billing|payment required/i.test(error)) return { kind: 'billing', message: '模型服务商的余额或资源包不足。请先在服务商处补充额度，或在模型设置中更换可用服务。任务内加额度不能解决这个问题。', action: '已处理，重试本任务', settings: true }
  if (/401|403|api.?key|密钥|unauthorized|authentication|model.*not found|模型.*不存在/i.test(error)) return { kind: 'configuration', message: '模型服务的密钥、权限或模型配置不可用。请检查该联系人使用的模型服务，修改后再重试。', action: '已检查，重试本任务', settings: true }
  if (/429|rate.?limit|超时|timeout|network|网络|ECONN|fetch failed|502|503|504/i.test(error)) return { kind: 'network', message: '模型服务暂时无法连接或请求受限，这次尝试中断。', action: '重试本任务', settings: false }
  if (/格式|校验|字段|JSON|parse|schema/i.test(error)) return { kind: 'format', message: '这次返回的成果没有通过格式校验，未作为新成果保存。可以重新尝试；反复出现时请查看工作记录。', action: '重新尝试', settings: false }
  return { kind: 'unknown', message: '这次尝试遇到尚未识别的异常，无法确定具体原因。下方保留了可安全展示的诊断信息。', action: '重新尝试', settings: false }
}

export function contactFailure(error: string): NonNullable<ContactInteraction['failure']> {
  const failure = classifyFailure(error)
  const titles: Record<NonNullable<ContactInteraction['failure']>['kind'], string> = {
    billing: '模型服务余额不足', configuration: '模型服务配置不可用', network: '模型服务暂时不可用',
    format: /工作计划|下次检查间隔/.test(error) ? '下一步计划未能生成' : '返回结果未通过检查',
    permission: '所需工具或资料未获授权', skill: '技能暂时无法运行', source: '参考资料读取受阻',
    'tool-limit': '工具调用达到上限', material: '参考资料读取受阻', chapter: '章节衔接尚未确认',
    output: '正文生成中断', storage: '成果未能保存', context: '参考内容已变化', unknown: '这次尝试意外中断'
  }
  return { ...failure, title: failure.title ?? titles[failure.kind] }
}

/** Bounded cadence, not a balance API: the next real task attempt probes availability. */
export function providerRecoveryDelay(error: string, failures: number, intervalMinutes = 0): number | undefined {
  if (failures < 3 || !['billing', 'network'].includes(contactFailure(error).kind)) return
  return Math.max(Math.min(60, 15 * 2 ** Math.min(2, failures - 3)), intervalMinutes) * 60000
}
