import { ASSISTANT_CHARACTER_ID } from '../../shared/characters'
import { applyContactProfilePatch, contactProfileProperties, describeContactProfilePatch, validateContactProfilePatch, type ContactProfilePatch, type ContactProfileSnapshot } from '../../shared/contact-profile-settings'
import { containsSecret } from '../../shared/memory'
import { skillReference, type SkillAction, type SkillListing } from '../../shared/skills'
import type { RegisteredTool, ToolExecutionContext } from '../tools/registry'

interface Access {
  owner(sessionId?: string): string | undefined
  profile(id: string): Promise<ContactProfileSnapshot>
  update(id: string, patch: ContactProfilePatch, revision: string, reason: string): Promise<ContactProfileSnapshot>
  skills(id: string): Promise<SkillListing>
  configure(id: string, skillId: string, action: SkillAction, revision: number): Promise<SkillListing>
}
export const skillActions: Record<SkillAction, string> = { enable: '已启用技能说明', disable: '已停用技能', remove: '已移除技能关联', enable_scripts: '已授权技能脚本', disable_scripts: '已撤销脚本授权' }
export function createContactProfileTools(access: Access): RegisteredTool[] {
  const owner = (context: ToolExecutionContext) => {
    const id = access.owner(context.sessionId)
    if (!id || id === ASSISTANT_CHARACTER_ID) throw new Error('请在具体联系人的聊天中修改设置。')
    return id
  }
  const reason = (raw: unknown) => {
    if (typeof raw !== 'string' || !raw.trim() || raw.length > 2000 || containsSecret(raw)) throw new Error('请提供有效的修改原话，不要包含凭据。')
    return raw.trim()
  }
  const common = { source: 'builtin' as const, risk: 'write' as const, requiresConfirmation: true, alwaysConfirm: true }
  return [
    { ...common, name: 'get_contact_configuration', displayName: '读取联系人设置', risk: 'read', requiresConfirmation: false, alwaysConfirm: false,
      description: '读取当前联系人真实资料、人设、模型及供应商目录、已安装技能和版本。仅返回可配置资料，不包含凭据。修改前必须读取，不能猜测ID或版本。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      async execute(_args, context) {
        const id = owner(context), profile = await access.profile(id), skills = await access.skills(id)
        return { content: JSON.stringify({ profile, skills }), summary: '已读取联系人资料和技能配置' }
      } },
    { ...common, name: 'edit_contact_profile', displayName: '修改联系人资料与模型',
      description: '用户明确要求修改当前联系人的名字、头像、分类、完整人设、供应商档案或模型时实际保存。只传明确修改字段，保留未撤销人设；不更改任务、不保存密钥。内置ChouYu的人设和模型写入系统默认配置，需说明对跟随默认模型的联系人影响。',
      inputSchema: { type: 'object', properties: { ...contactProfileProperties, revision: { type: 'string', description: '实际读取的64位版本，不可猜测' }, reason: { type: 'string', description: '用户修改原话，最多2000字符' } }, required: ['revision', 'reason'], additionalProperties: false },
      async prepareAsync(args, context) {
        const id = owner(context), current = await access.profile(id), original = reason(args.reason)
        if (typeof args.revision !== 'string' || args.revision !== current.revision) throw new Error('联系人资料已变化，请重新读取。')
        const { revision: _revision, reason: _reason, ...fields } = args
        const patch = validateContactProfilePatch(fields)
        if (containsSecret(JSON.stringify(patch))) throw new Error('请通过安全输入设置凭据，不要写入资料。')
        applyContactProfilePatch(current, patch)
        const description = describeContactProfilePatch(patch)
        let consumed = false
        return { preview: `${description}${patch.soulMd === undefined ? '' : `\n完整新的人设：\n${patch.soulMd || '（清空）'}`}\n${current.builtIn && patch.model !== undefined ? '此模型同时成为系统默认模型，跟随默认模型的联系人也会使用它。\n' : ''}新的资料用于后续请求，未提及字段保持不变。`, execute: async () => {
          if (consumed) throw new Error('此修改已执行，请重新发起。')
          consumed = true
          if (owner(context) !== id) throw new Error('聊天归属已变化，请重新确认。')
          const saved = await access.update(id, patch, current.revision, original)
          if (saved.characterId !== id || saved.revision === current.revision) throw new Error('未取得有效的联系人保存回执。')
          const message = `已保存联系人设置：${description}。后续请求使用新设置。`
          return { content: JSON.stringify({ saved: true, revision: saved.revision, message }), summary: message }
        } }
      }, execute: () => { throw new Error('请先准备联系人资料修改。') } },
    { ...common, name: 'configure_contact_skill', displayName: '配置联系人技能',
      description: '对当前联系人已安装的技能启用/停用说明、移除关联或授权/撤销脚本。先读取真实技能目录及revision。说明启用不代表脚本授权；脚本仍受隔离环境和工具开关约束。仅明确要求脚本执行时授权脚本。',
      inputSchema: { type: 'object', properties: { skillId: { type: 'string', description: '真实目录ID，最多160字符' }, action: { type: 'string', enum: Object.keys(skillActions) }, revision: { type: 'number' }, reason: { type: 'string', description: '用户修改原话，最多2000字符' } }, required: ['skillId', 'action', 'revision', 'reason'], additionalProperties: false },
      async prepareAsync(args, context) {
        const id = owner(context), skillId = skillReference(args.skillId), action = args.action as SkillAction
        reason(args.reason)
        if (!Object.hasOwn(skillActions, action)) throw new Error('技能配置操作无效。')
        const current = await access.skills(id), skill = current.skills.find(s => s.id === skillId)
        if (!skill) throw new Error('技能尚未安装，请先从真实技能目录安装。')
        if (!Number.isSafeInteger(args.revision) || args.revision !== current.revision) throw new Error('技能配置已变化，请重新读取。')
        let consumed = false
        return { preview: `技能：${skill.name}\n操作：${skillActions[action].replace(/^已/, '')}${action === 'enable_scripts' ? '\n允许该技能在隔离环境执行脚本；未就绪的运行环境仍需准备。' : ''}\n仅对当前联系人生效。`, execute: async () => {
          if (consumed) throw new Error('此操作已执行，请重新发起。')
          consumed = true
          if (owner(context) !== id) throw new Error('聊天归属已变化，请重新确认。')
          const saved = await access.configure(id, skillId, action, current.revision)
          if (!Number.isSafeInteger(saved.revision) || saved.revision <= current.revision) throw new Error('未取得有效的技能保存回执。')
          const message = `${skillActions[action]}：${skill.name}。${action === 'enable' ? '技能说明用于后续请求；脚本授权保持原设置。' : action === 'disable' ? '后续请求不再使用该技能。' : ''}`
          return { content: JSON.stringify({ saved: true, revision: saved.revision, message }), summary: message }
        } }
      }, execute: () => { throw new Error('请先准备技能配置修改。') } }
  ]
}
