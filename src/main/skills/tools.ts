import type { AIToolCall, AIToolDefinition } from '../../shared/tools'
import { parseToolArguments, validateToolArguments } from '../../shared/tools'
import type { SkillSnapshot } from '../../shared/skills'
import { SkillRunner, scriptArguments } from './runner'

const skill = { type: 'string' as const, description: '本轮已启用技能的完整 id，包括 @namespace/slug', maxLength: 160 }
const file = { type: 'string' as const, description: '相对技能包或工作目录的文件路径，禁止绝对路径和 ..', maxLength: 500 }
const base = { source: 'builtin' as const, risk: 'read' as const, requiresConfirmation: false }
export const SKILL_TOOLS: AIToolDefinition[] = [
  { ...base, name: 'read_skill_file', displayName: '读取技能文件', description: '读取当前联系人本轮已启用技能的说明、参考资料、脚本源码或工作文件。其它技能引用必须使用已启用的完整 id；不能访问任意电脑文件。', inputSchema: { type: 'object', properties: { skillId: skill, path: file, source: { type: 'string', description: 'package（安装包）或 workspace（该联系人的技能工作目录）' } }, required: ['skillId', 'path', 'source'], additionalProperties: false } },
  { ...base, name: 'write_skill_file', displayName: '保存技能工作文件', risk: 'write', description: '将设计、报告或脚本输入保存到当前联系人的独立技能工作目录。最多200KB，不修改安装包或用户其他文件。', inputSchema: { type: 'object', properties: { skillId: skill, path: file, content: { type: 'string', description: '完整文件内容', maxLength: 200000 } }, required: ['skillId', 'path', 'content'], additionalProperties: false } },
  { ...base, name: 'run_skill_script', displayName: '运行技能脚本', risk: 'write', description: '运行当前联系人明确启用脚本授权的技能包脚本。Node/Python/Bash 隔离容器，工作目录为 /work，安装包为 /skill，默认无网络；最长120秒，参数是JSON字符串数组。不能运行任意命令或新增脚本。环境或依赖未就绪时返回具体原因，不能声称成功。', inputSchema: { type: 'object', properties: { skillId: skill, path: file, argumentsJson: { type: 'string', description: 'JSON字符串数组，如 ["--input","/work/input.json"]', maxLength: 20000 }, timeoutSeconds: { type: 'number', description: '1–120秒，默认60秒' } }, required: ['skillId', 'path'], additionalProperties: false } },
  { ...base, name: 'get_skill_logs', displayName: '读取技能运行记录', description: '读取当前联系人的技能脚本、依赖准备和运行环境日志，用于核实实际结果及失败原因。', inputSchema: { type: 'object', properties: { skillId: skill }, required: ['skillId'], additionalProperties: false } }
]

export function skillToolRuntime(owner: string, snapshot: SkillSnapshot, runner: SkillRunner, signal: AbortSignal) {
  const definitions = snapshot.entries.length ? SKILL_TOOLS.filter(tool => tool.name !== 'run_skill_script' || snapshot.entries.some(entry => entry.scriptsEnabled)) : []
  const executeResult = async (call: AIToolCall) => {
    signal.throwIfAborted()
    runner.assertToolAllowed(call.name)
    const definition = definitions.find(tool => tool.name === call.name)
    if (!definition) throw new Error('当前技能未提供该工具。')
    const args = validateToolArguments(definition.inputSchema, parseToolArguments(call.arguments))
    const id = String(args.skillId)
    if (!snapshot.entries.some(entry => entry.id === id)) throw new Error('当前轮次未启用该技能。')
    if (call.name === 'read_skill_file') {
      if (!['package', 'workspace'].includes(String(args.source))) throw new Error('文件来源必须是 package 或 workspace。')
      return { content: runner.readFile(owner, snapshot, id, String(args.path), args.source as 'package' | 'workspace'), summary: `已读取 ${args.path}` }
    }
    if (call.name === 'write_skill_file') { const result = runner.writeFile(owner, snapshot, id, String(args.path), String(args.content)); return { content: result, summary: result } }
    if (call.name === 'get_skill_logs') return { content: JSON.stringify(runner.logs(owner, id)), summary: '已读取实际运行日志。' }
    const timeout = args.timeoutSeconds ?? 60
    if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout < 1 || timeout > 120) throw new Error('脚本超时必须为 1–120 秒。')
    const result = await runner.run(owner, snapshot, id, String(args.path), scriptArguments(String(args.argumentsJson || '[]')), signal, timeout * 1000)
    return { content: JSON.stringify(result), summary: result.summary }
  }
  return { definitions, executeResult, execute: async (call: AIToolCall) => { try { return (await executeResult(call)).content } catch (error) { if (signal.aborted) throw error; return `技能工具失败：${error instanceof Error ? error.message : String(error)}` } } }
}
