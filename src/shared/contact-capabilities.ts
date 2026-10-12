import type { ContactSkill, SkillRuntimeStatus } from './skills'
export function extractSkillExamples(content: string): string[] {
  const examples: string[] = []; let section = false, fence = false
  for (const line of content.split('\n')) {
    if (/^\s*```/.test(line)) { fence = !fence; continue }
    if (fence) continue
    if (/^#{1,6}\s/.test(line)) { section = /^#{1,6}\s+(?:examples?|usage|示例|使用示例|用法)\s*[:：]?\s*$/i.test(line.trim()); continue }
    if (!section) continue
    const value = line.replace(/^\s*(?:[-*]|\d+\.)\s+/, '').trim()
    if (value && value.length <= 500 && !/^(?:\$|https?:|<|`)/.test(value)) examples.push(value)
    if (examples.length === 3) break
  }
  return examples
}
export function skillCapability(skill: ContactSkill & { examples?: string[] }, runtime: SkillRuntimeStatus) {
  const instructionReady = skill.enabled && !skill.unavailableReason, report = skill.compatibility
  const scripts = Boolean(report?.scripts.length), dependenciesReady = !report?.dependencyFiles.length || runtime.dependencies?.[skill.digest] === true
  const requirements: string[] = []
  if (!instructionReady) requirements.push(skill.unavailableReason || '请为此联系人启用技能说明。')
  if (scripts && !skill.scriptsEnabled) requirements.push('脚本尚未授权。')
  if (scripts && !runtime.ready) requirements.push(runtime.message)
  if (scripts && !dependenciesReady) requirements.push('技能依赖未准备或尚未验证。')
  for (const external of report?.externalRequirements ?? []) requirements.push(`外部条件（未验证）：${external}`)
  return { instructionReady, scriptReady: Boolean(instructionReady && scripts && skill.scriptsEnabled && runtime.ready && dependenciesReady), requirements, examples: skill.examples ?? [] }
}
