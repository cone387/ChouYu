import { describe, expect, it } from 'vitest'
import { calculateEvaluations, evaluationMarkdown } from './agent-evaluation'

export const sampleEvaluation = () => ({ subject: 'PRD-代码一致性校验器', sourceNumbers: [1],
  dimensions: [
    ['问题真实性', 65, 20], ['方案可行性', 75, 25], ['技术可行性', 80, 20],
    ['验证设计', 70, 15], ['差异化', 60, 10], ['资源合理性', 75, 10]
  ].map(([name, score, weight]) => ({ name, score, maxScore: 100, weight, reason: '依据原文，尚需验证' })),
  summary: '先做低成本验证', risks: '缺少用户访谈', nextStep: '验证需求', claimedTotal: 68 })

describe('evaluation arithmetic', () => {
  it('corrects the real 68 vs 71.75 error without changing agent judgements', () => {
    const raw = sampleEvaluation(), before = JSON.stringify(raw)
    const [result] = calculateEvaluations([raw], 1)
    expect(result.total).toBe(71.75)
    expect(result.claimedTotal).toBe(68)
    expect(result.dimensions).toEqual(raw.dimensions)
    expect(JSON.stringify(raw)).toBe(before)
    expect(evaluationMarkdown([result])).toContain('系统计算总分：71.75/100')
    expect(evaluationMarkdown([result])).toContain('模型原报 68/100')
  })
  it('normalizes mixed scales, supports zero scores and rounds only the total', () => {
    const raw = sampleEvaluation()
    raw.dimensions = [{ name: 'a', score: 4, maxScore: 5, weight: 25, reason: 'a' }, { name: 'b', score: 0, maxScore: 10, weight: 25, reason: 'b' }, { name: 'c', score: 1, maxScore: 3, weight: 50, reason: 'c' }]
    expect(calculateEvaluations([raw], 1)[0].total).toBe(36.67)
  })
  it.each([NaN, Infinity, -1, 101, '65'])('rejects invalid dimension scores %s', score => {
    const raw = sampleEvaluation(); raw.dimensions[0].score = score as number
    expect(() => calculateEvaluations([raw], 1)).toThrow('评分超出')
  })
  it('rejects invalid weights, zero scales, duplicate dimensions and fabricated citations', () => {
    const raw = sampleEvaluation(); raw.dimensions[0].weight = 19
    expect(() => calculateEvaluations([raw], 1)).toThrow('100%')
    raw.dimensions[0].weight = 20; raw.dimensions[0].maxScore = 0
    expect(() => calculateEvaluations([raw], 1)).toThrow('评分超出')
    raw.dimensions[0].maxScore = 100; raw.dimensions[0].name = raw.dimensions[1].name
    expect(() => calculateEvaluations([raw], 1)).toThrow('重复')
    expect(() => calculateEvaluations([sampleEvaluation()], 0)).toThrow('资料编号')
  })
  it('ignores a forged computed total and keeps separate totals per subject', () => {
    const result = calculateEvaluations([{ ...sampleEvaluation(), total: 100 }, { ...sampleEvaluation(), subject: 'idea2' }], 1)
    expect(result.map(r => r.total)).toEqual([71.75, 71.75])
  })
})
