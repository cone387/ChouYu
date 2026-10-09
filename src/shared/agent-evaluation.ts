export interface EvaluationDimension {
  name: string; score: number; maxScore: number; weight: number; reason: string
}
export interface AgentEvaluation {
  subject: string; sourceNumbers: number[]; dimensions: EvaluationDimension[]
  summary: string; risks: string; nextStep: string
  claimedTotal?: number
  total: number
}

/** Weights and judgements belong to the agent; arithmetic belongs to the application. */
export function calculateEvaluations(raw: unknown, evidenceCount?: number): AgentEvaluation[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > 3) throw new Error('评分需包含 1–3 个评价对象。')
  const text = (value: unknown, max: number): string => {
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('评分对象、维度与理由需填写有效文本。')
    return value.trim()
  }
  const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
  return raw.map(value => {
    if (!value || typeof value !== 'object') throw new Error('评分结构无效。')
    const subject = text(value.subject, 160)
    if (!Array.isArray(value.sourceNumbers) || value.sourceNumbers.length > 5 || value.sourceNumbers.some((n: unknown) => !Number.isSafeInteger(n) || Number(n) < 1 || evidenceCount !== undefined && Number(n) > evidenceCount)) throw new Error('评分引用了未实际读取的资料编号。')
    if (!Array.isArray(value.dimensions) || !value.dimensions.length || value.dimensions.length > 12) throw new Error('评分维度数量应为 1–12 个。')
    const dimensions: EvaluationDimension[] = value.dimensions.map((d: any) => {
      if (!d || !finite(d.score) || !finite(d.maxScore) || !finite(d.weight) || d.maxScore <= 0 || d.maxScore > 1000 || d.score < 0 || d.score > d.maxScore || d.weight <= 0 || d.weight > 100) throw new Error('评分超出量表范围，或权重无效；不能自动猜测或裁剪。')
      return { name: text(d.name, 80), score: d.score, maxScore: d.maxScore, weight: d.weight, reason: text(d.reason, 400) }
    })
    if (new Set(dimensions.map(d => d.name.toLocaleLowerCase())).size !== dimensions.length) throw new Error('评分维度名称不能重复。')
    if (Math.abs(dimensions.reduce((sum, d) => sum + d.weight, 0) - 100) > 0.000001) throw new Error('评分权重之和必须为 100%，系统不会擅自调整权重。')
    if (value.claimedTotal !== undefined && (!finite(value.claimedTotal) || value.claimedTotal < 0 || value.claimedTotal > 100)) throw new Error('模型原报总分无效。')
    const total = Math.round((dimensions.reduce((sum, d) => sum + d.score / d.maxScore * d.weight, 0) + Number.EPSILON) * 100) / 100
    return { subject, sourceNumbers: [...new Set<number>(value.sourceNumbers)], dimensions,
      summary: text(value.summary, 500), risks: text(value.risks, 500), nextStep: text(value.nextStep, 500),
      ...(value.claimedTotal !== undefined ? { claimedTotal: value.claimedTotal } : {}), total }
  })
}

const cell = (value: string) => value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ')
export function evaluationSummary(evaluations: AgentEvaluation[]) {
  return evaluations.map(e => `${e.subject}：${e.total}/100（系统计算）`).join('；')
}
export function evaluationMarkdown(evaluations: AgentEvaluation[]) {
  return evaluations.map(e => `## ${cell(e.subject)}\n\n${e.summary}\n\n**综合评分：${e.total}/100**\n\n${e.sourceNumbers.length ? `依据：${e.sourceNumbers.map(n => `[${n}]`).join(' ')}` : '目前没有外部资料支持，这是我的初步判断。'}\n\n| 维度 | 得分 / 满分 | 权重 | 理由 |\n|---|---:|---:|---|\n${e.dimensions.map(d => `| ${cell(d.name)} | ${d.score} / ${d.maxScore} | ${d.weight}% | ${cell(d.reason)} |`).join('\n')}\n\n风险：${e.risks}\n\n验证建议：${e.nextStep}\n\n总分按各项得分占满分的比例加权计算；这些评分不等于已经验证的市场结论。`).join('\n\n')
}

export const evaluationInstruction = `\n评分输出规则：本轮如果要评价打分，必须提供顶层 evaluations 数组（1–3项），不要在正文手写评分表或总分。每项为 {"subject":"对象名称","sourceNumbers":[1],"dimensions":[{"name":"由你制定的维度","score":4,"maxScore":5,"weight":100,"reason":"评分理由"}],"summary":"定性结论","risks":"主要风险","nextStep":"最小验证建议"}。维度、量表与权重由你根据任务自行制定，延用历史标准以保持可比性；确需调整时解释原因。每项所有权重必须合计100（百分比数值，不是0到1的小数），每个得分在0到maxScore之间，维度名称唯一。sourceNumbers只引用本轮真实读取的资料编号；没有外部资料时留空。不要输出 total，不要在摘要、记忆或其他文本里复述总分。若要保留此前错误总分供校验，可提供 claimedTotal（0–100）。系统计算百分制总分，并根据 evaluations 自动生成正式成果正文；delivery.section.body 可只写“评分由系统生成”。其他要求的 JSON 字段仍需完整返回，整份输出保持简短。`
