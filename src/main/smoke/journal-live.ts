import { generateJournalSummary } from '../journal/summary'
import type { AppConfig } from '../../shared/config'

export async function runJournalAcceptance(config: AppConfig) {
  const from = Date.parse('2026-09-07T00:00:00+08:00')
  const result = await generateJournalSummary({ from, to: from + 86400_000, truncated: false, sources: [
    { id: 'activity:1', at: from + 9 * 3600_000, app: 'editor.exe', title: '登录接口排查.md', text: '观察到文档正在记录 HTTP 401 报错的排查步骤，尚无修复结论。' },
    { id: 'capture:00000000-0000-4000-8000-000000000001', at: from + 9 * 3600_000 + 60000, app: 'browser.exe', title: '接口文档', text: 'HTTP 401 Unauthorized。待检查：请求头、凭据是否过期。' },
    { id: 'activity:2', at: from + 10 * 3600_000, app: 'editor.exe', title: '工作日志设计草稿', text: '草稿列出了定时采集、OCR 和时间线三个模块，没有实现或测试结果。' }
  ] }, config, AbortSignal.timeout(60_000))
  const unsupportedCompletion = result.items.some(item => /已修复|修复完成|已经解决|部署成功|已上线/.test(item.text))
  return { passed: !unsupportedCompletion && result.items.length > 0, model: result.model, items: result.items, sources: result.sources, unsupportedCompletion, note: 'Synthetic evidence only; checks valid citations and selected unsupported completion phrases, not general summary accuracy.' }
}
