import type { AgentResearchPlan, AgentSearchResult } from '../../shared/agents'
import { validateTaskResourceBudget } from '../../shared/agent-resources'
import { containsSecret } from '../../shared/memory'

export class InvalidSectionReferenceError extends Error {}

export function researchUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2000) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443') return null
    if ([...url.searchParams.keys()].some(key => /^(api[_-]?key|access[_-]?token|token|password|secret|authorization|signature)$/i.test(key))) return null
    url.hash = ''; return url.href
  } catch { return null }
}
export function parseResearchPlan(raw: string, allowed: string[], minimum: number, permission: 'public' | 'sources' = 'sources', searchEnabled = true, contactAccess = false): AgentResearchPlan {
  let value: any
  try { value = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) } catch { throw new Error('研究计划格式无效。') }
  if (!value || !['search', 'read', 'wait', 'write', 'discover_contacts', 'read_contacts'].includes(value.action) || typeof value.reason !== 'string' || !value.reason.trim() || value.reason.length > 1000) throw new Error('研究计划必须说明动作与原因。')
  const contactAction = ['discover_contacts', 'read_contacts'].includes(value.action)
  if (contactAction && !contactAccess) throw new Error('未授权读取联系人的共享成果。')
  if (contactAction && (!Array.isArray(value.urls) || value.urls.length)) throw new Error('联系人成果读取不能混用网页地址。')
  if (value.action === 'read_contacts' && (!Array.isArray(value.contactRefs) || !value.contactRefs.length || value.contactRefs.length > 3 || value.contactRefs.some((ref: any) => !ref || ![ref.characterId, ref.topicId, ref.sectionId].every(id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id)) || !Number.isSafeInteger(ref.version) || ref.version < 1))) throw new Error('请从检索结果中选择有效的成果版本与分节。')
  const query = typeof value.query === 'string' ? value.query.trim() : ''
  if (query.length > 300 || containsSecret(query) || value.action === 'search' && !query) throw new Error('搜索词无效或包含敏感凭据。')
  if (value.action === 'search' && (!searchEnabled || permission === 'sources')) throw new Error('当前权限或配置不允许自主搜索。')
  if (!Array.isArray(value.urls) || value.urls.length > 5 || value.urls.some((url: unknown) => !researchUrl(url) || permission === 'sources' && !allowed.includes(researchUrl(url)!))) throw new Error('研究计划包含当前权限不允许读取的网页。')
  if (value.action === 'read' && !value.urls.length) throw new Error('读取计划缺少网页。')
  if (value.action === 'write' && (value.urls.length || query)) throw new Error('直接写作计划不能声称搜索或读取网页。')
  if (!Number.isInteger(value.checkAfterMinutes) || value.checkAfterMinutes < 15 || value.checkAfterMinutes > 10080) throw new Error('下次检查间隔无效。')
  const sectionId = typeof value.sectionId === 'string' ? value.sectionId.trim() : value.sectionId
  if (sectionId != null && sectionId !== '' && (typeof sectionId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(sectionId))) throw new InvalidSectionReferenceError('规划中的待修订分节 ID 格式无效。')
  return { action: value.action, reason: value.reason.trim(), query: ['search', 'discover_contacts'].includes(value.action) ? query : '', ...(value.action === 'read_contacts' ? { contactRefs: value.contactRefs.map((ref: any) => ({ characterId: ref.characterId, topicId: ref.topicId, version: ref.version, sectionId: ref.sectionId })) } : {}), urls: [...new Set(value.urls.map(researchUrl))] as string[], checkAfterMinutes: Math.max(minimum, value.checkAfterMinutes), ...(sectionId ? { sectionId } : {}), ...(value.resourceBudget ? { resourceBudget: validateTaskResourceBudget(value.resourceBudget) } : {}) }
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
