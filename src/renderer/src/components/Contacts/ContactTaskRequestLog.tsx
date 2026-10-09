export default function ContactTaskRequestLog({ value }: { value?: string }) {
  return <section className="topic-request-log" aria-label="任务需求记录">
    <h4>任务需求记录</h4>
    <p className="agent-caption">已保存的原始要求、补问与修改；当前执行要求以任务概览为准。</p>
    {value?.trim() ? <details><summary>查看原始要求、补问与修改</summary><div className="topic-request-log-text">{value}</div></details>
      : <p className="agent-empty">此任务没有留存需求沟通记录，无法还原原始要求。</p>}
  </section>
}
