import { skillReference, type InstalledSkill, type SkillCatalogPage, type SkillListing, type SkillRuntimeStatus } from '../../shared/skills'
import { containsSecret } from '../../shared/memory'
import type { MaterialVersion } from '../../shared/contact-materials'
import type { RegisteredTool, ToolExecutionContext } from '../tools/registry'

interface Access {
  owner(sessionId?: string): string | undefined
  credential(owner: string): { configured: boolean; revision: number }
  saveCredential(owner: string, secret: string, revision: number): { configured: boolean; revision: number }
  skills(owner: string): Promise<SkillListing>
  catalog(query: string): Promise<SkillCatalogPage>
  runtime(skillId?: string): Promise<SkillRuntimeStatus>
  install(id: string): Promise<InstalledSkill>
  prepareRuntime(): Promise<SkillRuntimeStatus>
  prepareDependencies(owner: string, id: string): Promise<void>
  material(owner: string, name: string, topicId: string | undefined, context: ToolExecutionContext): Promise<MaterialVersion | null>
}
export function createContactSupportTools(access: Access): RegisteredTool[] {
  const owner = (context: ToolExecutionContext) => { const id = access.owner(context.sessionId); if (!id) throw new Error('请在具体联系人的会话中操作。'); return id }
  const reason = (value: unknown) => { if (typeof value !== 'string' || !value.trim() || value.length > 2000 || containsSecret(value)) throw new Error('请提供有效的修改原话，不要把凭据写入对话。') }
  const checked = async (id: string, revision: unknown) => { const listing = await access.skills(id); if (!Number.isSafeInteger(revision) || listing.revision !== revision) throw new Error('技能配置已变化，请重新读取。'); return listing }
  const properties = { revision: { type: 'number' as const, description: 'get_contact_support中实际读取的版本' }, reason: { type: 'string' as const, description: '用户本条要求，最多2000字符，不含凭据' } }
  const common = { source: 'builtin' as const, risk: 'write' as const, requiresConfirmation: true, alwaysConfirm: true }
  return [
    { ...common, name: 'get_contact_support', displayName: '读取联系人运行配置', risk: 'read', requiresConfirmation: false, alwaysConfirm: false,
      description: '读取当前联系人搜索凭据是否配置及版本、已安装技能及版本、真实运行环境状态。不会返回密钥。设置搜索密钥前必读；安装、环境准备前必读技能版本。', inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      async execute(_args, context) { const id = owner(context); return { content: JSON.stringify({ searchCredential: access.credential(id), skills: await access.skills(id), runtime: await access.runtime() }), summary: '已读取搜索与技能环境配置，不含凭据' } } },
    { ...common, name: 'find_contact_skills', displayName: '查找可安装技能', risk: 'read', requiresConfirmation: false, alwaysConfirm: false,
      description: '从现有技能市场目录查找真实技能。结果只代表可选技能，不代表已安装、启用或授权脚本。', inputSchema: { type: 'object', properties: { query: { type: 'string', description: '关键词，最多200字符' } }, required: ['query'], additionalProperties: false },
      async execute(args, context) { owner(context); if (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 200 || containsSecret(args.query)) throw new Error('搜索词无效。'); const result = await access.catalog(args.query); return { content: JSON.stringify(result), summary: `读到 ${result.skills.length} 个技能条目` } } },
    { ...common, name: 'set_contact_search_credential', displayName: '更新联系人搜索密钥',
      description: '用户要求更新搜索密钥时发送专用安全输入卡片。只传真实凭据revision和修改原话，不接受密钥作为模型参数；不要让用户在聊天里粘贴密钥。保存密钥不会自动打开搜索权限。',
      inputSchema: { type: 'object', properties, required: ['revision', 'reason'], additionalProperties: false },
      async prepareAsync(args, context) {
        const id = owner(context); reason(args.reason)
        if (access.credential(id).revision !== args.revision) throw new Error('搜索凭据已变化，请重新读取。')
        return { confirmationRequired: true, preview: '通过安全输入更新此联系人的搜索密钥。搜索权限保持原设置。', execute: async () => {
          if (!context.secureInput) throw new Error('请在卡片的安全输入中填写密钥。')
          if (owner(context) !== id) throw new Error('会话归属已变化。')
          const saved = access.saveCredential(id, context.secureInput, args.revision as number)
          return { content: JSON.stringify({ saved: true, ...saved, message: '搜索密钥已保存，搜索权限保持原设置。' }), summary: '搜索密钥已保存，搜索权限保持原设置。' }
        } }
      }, execute: () => { throw new Error('请通过安全输入卡片操作。') } },
    { ...common, name: 'install_contact_skill', displayName: '安装联系人技能',
      description: '仅安装find_contact_skills返回的真实技能，不自动启用说明或授权脚本。已有技能不重复安装。准备技能市场下载组件只在确认后进行。',
      inputSchema: { type: 'object', properties: { ...properties, skillId: { type: 'string' } }, required: ['skillId', 'revision', 'reason'], additionalProperties: false },
      async prepareAsync(args, context) {
        const id = owner(context), skillId = skillReference(args.skillId); reason(args.reason)
        const listing = await checked(id, args.revision), installed = listing.skills.find(s => s.id === skillId)
        if (installed) { const result = { content: JSON.stringify({ installed: true, skillId, enabled: installed.enabled }), summary: '此技能已安装，启用和脚本权限保持原设置。' }; return { noOpResult: result, execute: () => result } }
        const candidate = (await access.catalog(skillId)).skills.find(s => s.id === skillId)
        if (!candidate) throw new Error('真实技能目录中没有此条目，请重新查找。')
        return { preview: `安装「${candidate.name}」（${skillId}）。将下载技能包；如需要，会先准备技能市场组件。不会自动启用或授权脚本。`, execute: async () => {
          if (owner(context) !== id) throw new Error('会话归属已变化。')
          await checked(id, args.revision)
          const saved = await access.install(skillId)
          return { content: JSON.stringify({ installed: true, skillId: saved.id, digest: saved.digest, enabled: false, message: '技能已安装，未自动启用或授权脚本。' }), summary: '技能已安装，未自动启用或授权脚本。' }
        } }
      }, execute: () => { throw new Error('请先准备技能安装。') } },
    { ...common, name: 'prepare_contact_skill_environment', displayName: '准备技能运行环境',
      description: '准备共享隔离运行环境(phase=runtime)或当前联系人已启用技能的依赖(phase=dependencies，需skillId)。沿用原运行环境与依赖安装服务；不授权脚本，不运行任务。可能下载镜像/依赖。',
      inputSchema: { type: 'object', properties: { ...properties, phase: { type: 'string', enum: ['runtime', 'dependencies'] }, skillId: { type: 'string' } }, required: ['phase', 'revision', 'reason'], additionalProperties: false },
      async prepareAsync(args, context) {
        const id = owner(context); reason(args.reason)
        const listing = await checked(id, args.revision), skillId = args.phase === 'dependencies' ? skillReference(args.skillId) : undefined
        if (skillId && !listing.skills.some(s => s.id === skillId && s.enabled)) throw new Error('请先启用此联系人的实际技能说明。')
        return { preview: skillId ? `在隔离环境中为「${skillId}」下载并准备声明的依赖；不会授权或运行技能脚本。` : '准备共享的隔离运行环境，可能下载基础镜像。不会运行任务或授权技能脚本。', execute: async () => {
          if (owner(context) !== id) throw new Error('会话归属已变化。')
          await checked(id, args.revision)
          if (skillId) await access.prepareDependencies(id, skillId)
          else { const state = await access.prepareRuntime(); if (!state.ready) throw new Error(state.message) }
          return { content: JSON.stringify({ saved: true, ready: true, skillId, message: '所选运行环境准备已完成，脚本权限保持原设置。' }), summary: '所选运行环境准备已完成，脚本权限保持原设置。' }
        } }
      }, execute: () => { throw new Error('请先准备环境操作。') } },
    { ...common, name: 'provide_contact_material', displayName: '提供联系人资料',
      description: '需要用户提供文本资料时，发送选择文件卡片，由用户亲自选择txt/md文件并保存到当前联系人。可指定已读取的topicId限制资料仅用于该任务；不读取猜测路径、不自动启动或恢复工作。',
      inputSchema: { type: 'object', properties: { name: { type: 'string', description: '资料名称，最多160字符' }, topicId: { type: 'string' } }, required: ['name'], additionalProperties: false },
      async prepareAsync(args, context) {
        const id = owner(context)
        if (typeof args.name !== 'string' || !args.name.trim() || args.name.length > 160) throw new Error('资料名称无效。')
        return { confirmationRequired: true, preview: `选择一份文本文件作为「${args.name}」，保存到${args.topicId ? '指定任务' : '此联系人'}的资料库。不会自动继续任务。`, execute: async () => {
          if (owner(context) !== id) throw new Error('会话归属已变化。')
          const saved = await access.material(id, String(args.name), args.topicId as string | undefined, context)
          return saved ? { content: JSON.stringify({ saved: true, id: saved.id, version: saved.version, message: '资料已保存，任务状态保持不变。' }), summary: '资料已保存，任务状态保持不变。' }
            : { content: JSON.stringify({ cancelled: true, saved: false, message: '已取消文件选择，未保存资料。' }), summary: '已取消文件选择，未保存资料。' }
        } }
      }, execute: () => { throw new Error('请通过文件选择卡片操作。') } }
  ]
}
