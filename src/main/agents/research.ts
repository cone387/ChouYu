import type { AgentResearchPlan, AgentSearchResult } from '../../shared/agents'
import { containsSecret } from '../../shared/memory'

export function researchUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2000) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443') return null
    if ([...url.searchParams.keys()].some(key => /^(api[_-]?key|access[_-]?token|token|password|secret|authorization|signature)$/i.test(key))) return null
    url.hash = ''; return url.href
  } catch { return null }
}
export function parseResearchPlan(raw: string, allowed: string[], minimum: number): AgentResearchPlan {
  let value: any
  try { value = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) } catch { throw new Error('研究计划格式无效。') }
  if (!value || !['search', 'read', 'wait'].includes(value.action) || typeof value.reason !== 'string' || !value.reason.trim() || value.reason.length > 1000) throw new Error('研究计划必须说明动作与原因。')
  const query = typeof value.query === 'string' ? value.query.trim() : ''
  if (query.length > 300 || containsSecret(query) || value.action === 'search' && !query) throw new Error('搜索词无效或包含敏感凭据。')
  if (!Array.isArray(value.urls) || value.urls.length > 5 || value.urls.some((url: unknown) => !researchUrl(url) || !allowed.includes(researchUrl(url)!))) throw new Error('计划只能直接读取已授权或此前实际发现的网页。')
  if (value.action === 'read' && !value.urls.length) throw new Error('读取计划缺少网页。')
  if (!Number.isInteger(value.checkAfterMinutes) || value.checkAfterMinutes < 15 || value.checkAfterMinutes > 10080) throw new Error('下次检查间隔无效。')
  return { action: value.action, reason: value.reason.trim(), query: value.action === 'search' ? query : '', urls: [...new Set(value.urls.map(researchUrl))] as string[], checkAfterMinutes: Math.max(minimum, value.checkAfterMinutes) }
}
export type AgentSearcher = (query: string, key: string, signal: AbortSignal) => Promise<AgentSearchResult[]>
/** Fixed API origin; credentials never follow redirects or enter an evidence record. */
export const searchBrave: AgentSearcher = async (query, key, signal) => {
  if (!key.trim()) throw new Error('请先配置 Brave Search API Key。')
  const url = new URL('https://api.search.brave.com/res/v1/web/search')
  url.searchParams.set('q', query); url.searchParams.set('count', '3'); url.searchParams.set('result_filter', 'web')
  const timeout = AbortSignal.timeout(15000)
  const response = await fetch(url, { headers: { 'X-Subscription-Token': key, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.any([signal, timeout]) })
  if (!response.ok) { await response.body?.cancel(); throw new Error(`搜索失败（HTTP ${response.status}），请检查密钥或额度。`) }
  if (!response.body) throw new Error('搜索未返回内容。')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 512 * 1024) throw new Error('搜索响应超过读取上限。'); chunks.push(value) }
  } finally { await reader.cancel().catch(() => {}) }
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (data.web?.results !== undefined && !Array.isArray(data.web.results)) throw new Error('搜索结果格式无效。')
  const results: AgentSearchResult[] = [], seen = new Set<string>()
  for (const result of (data.web?.results || []).slice(0, 20)) {
    const address = researchUrl(result?.url)
    if (!address || seen.has(address)) continue
    seen.add(address); results.push({ url: address, title: typeof result.title === 'string' ? result.title.slice(0, 200) : new URL(address).hostname })
    if (results.length === 3) break
  }
  return results
}
