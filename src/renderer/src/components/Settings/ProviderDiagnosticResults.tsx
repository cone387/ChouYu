import type { ProviderDiagnostics } from '../../../../shared/ai'

export default function ProviderDiagnosticResults({ diagnostics }: { diagnostics: ProviderDiagnostics }) {
  const { conversation, embedding } = diagnostics
  return <div className="settings-diagnostics" aria-label="Provider 能力诊断">
    <div className={`settings-diagnostic-item ${diagnostics.state}`}><span>对话 Provider</span><strong>{diagnostics.state === 'ready' ? '可用' : diagnostics.state === 'unconfigured' ? '待配置' : '需检查'}</strong><small>{diagnostics.message}</small></div>
    <div className="settings-diagnostic-item"><span>实际对话测试</span><small>请求模型：{conversation.requestedModel || '未配置'} · 返回模型：{conversation.returnedModel || '未返回'}</small><small>{conversation.httpStatus ? `HTTP ${conversation.httpStatus} · ` : ''}{conversation.elapsedMs} ms · {conversation.completed ? '已收到结束标记' : '未完成响应'}</small>{conversation.reply && <small>回复：{conversation.reply}</small>}</div>
    <div className={`settings-diagnostic-item ${embedding.state}`}><span>Embedding 能力</span><strong>{embedding.state === 'ready' ? '可用' : embedding.state === 'disabled' ? '未启用' : embedding.state === 'unconfigured' ? '待配置' : '不可用'}</strong><small>{embedding.message}</small></div>
  </div>
}
