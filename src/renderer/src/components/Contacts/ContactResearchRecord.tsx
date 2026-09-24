import type { AgentResearch } from '../../../../shared/agents'

export default function ContactResearchRecord({ research }: { research: AgentResearch }) {
  return <section className="agent-research-record" aria-label="本轮验证过程">
    <h4>本轮实际做了什么</h4>
    <p><strong>{research.plan.action === 'write' ? '直接写作' : research.plan.action === 'search' ? '搜索并核对' : research.plan.action === 'read' ? '重新读取资料' : '等待外部变化'}：</strong>{research.plan.reason}</p>
    {research.plan.action === 'write' && <p>本轮根据任务描述与已有成果创作，没有搜索或读取网页。</p>}
    {research.searches.map((search, index) => <div key={index}>
      <p><strong>检索词：</strong>{search.query}<br /><small>{new Date(search.at).toLocaleString()}</small></p>
      {search.error ? <p className="agent-error">{search.error}</p> : !search.results.length ? <p>没有找到可读取的结果。</p> : <ul>{search.results.map(result => <li key={result.url}><a href={result.url} target="_blank" rel="noopener noreferrer">{result.title}</a></li>)}</ul>}
    </div>)}
    {research.reads.length > 0 && <details><summary>网页核对 · 成功 {research.reads.filter(r => r.status === 'read').length}/{research.reads.length}</summary><ul>{research.reads.map(read => <li key={read.url}><span>{read.status === 'read' ? '已读正文' : '读取失败，未作为证据'} · </span><a href={read.url} target="_blank" rel="noopener noreferrer">{read.url}</a></li>)}</ul></details>}
    {research.unchanged && <p>资料未变，沿用原判断；本轮没有生成新报告。</p>}
    {research.nextCheckAt && <p className="agent-caption">计划下次检查：{new Date(research.nextCheckAt).toLocaleString()}。仅在持续工作开启、事项可继续且额度允许时执行。</p>}
  </section>
}
