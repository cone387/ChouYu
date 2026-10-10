import type { SkillCompatibility } from '../../shared/skills'

/** A file/declared-requirement inventory, not a claim of semantic compatibility. */
export function skillCompatibility(files: string[], texts: { path: string; content: string }[]): SkillCompatibility {
  const scripts: SkillCompatibility['scripts'] = [], dependencyFiles: string[] = [], unsupportedFiles: string[] = [], assets: string[] = []
  for (const path of files) {
    if (/\.(?:js|mjs|cjs)$/i.test(path)) scripts.push({ path, runtime: 'node' })
    else if (/\.py$/i.test(path)) scripts.push({ path, runtime: 'python' })
    else if (/\.(?:sh|bash)$/i.test(path)) scripts.push({ path, runtime: 'shell' })
    else if (/\.(?:ps1|bat|cmd|exe|dll|so|wasm|ts|tsx)$/i.test(path)) unsupportedFiles.push(path)
    else if (!/\.(?:md|txt|json|ya?ml|csv)$/i.test(path)) assets.push(path)
    if (/(^|\/)(?:package(?:-lock)?\.json|requirements[^/]*\.txt|pyproject\.toml|Pipfile|Dockerfile)$/i.test(path)) dependencyFiles.push(path)
  }
  const externalRequirements: string[] = []
  for (const text of texts) for (const line of text.content.split(/\r?\n/)) {
    if (/\bMCP\s+(?:server|tool|connection)|\b(?:requires?|needs?|must (?:have|use)|prerequisites?)\b[^\n]{0,200}\b(?:account|api key|token|external service|credential)\b|(?:需要|必须|依赖|请先)[^\n]{0,100}(?:API|MCP|密钥|凭据|账号|账户|登录|外部服务)/i.test(line)) externalRequirements.push(`${text.path}: ${line.trim().slice(0, 400)}`)
  }
  return { scripts, dependencyFiles, externalRequirements: [...new Set(externalRequirements)].slice(0, 12), unsupportedFiles, assets }
}

export function capabilityInstruction(report: SkillCompatibility, scriptsEnabled: boolean): string {
  return `\n本技能当前能力：说明与文本参考可用。${scriptsEnabled ? '已允许通过 run_skill_script 在隔离环境运行登记脚本；依赖或环境未就绪时工具会返回具体错误。' : '脚本未授权；使用可独立完成的文字流程，跳过可选脚本分支。若当前请求必须依赖脚本，明确告知缺口，不假装完成。'}\n已登记脚本：${JSON.stringify(report.scripts)}\n外部服务未连接：${JSON.stringify(report.externalRequirements)}\n不支持的执行文件：${JSON.stringify(report.unsupportedFiles)}\n文件读写只用技能工作目录工具；其它技能引用只可读取当前联系人已启用的技能。`
}
