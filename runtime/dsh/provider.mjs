/** Map already resolved ChouYu configuration; never discover ambient credentials. */
export function mapProvider(config, needs) {
  if (!['openai', 'claude'].includes(config.provider)) throw new Error('DSH 不支持此供应商，尚未执行。');
  if (!config.apiKey?.trim()) throw new Error('缺少模型密钥，尚未执行。');
  if (config.apiKey.startsWith('safe:v1:')) throw new Error('模型密钥尚未由主进程解密，尚未执行。');
  if (!config.model?.trim()) throw new Error('缺少模型名称，尚未执行。');
  let url;
  try { url = new URL(config.baseUrl); } catch { throw new Error('模型端点无效，尚未执行。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('模型端点必须是无内嵌凭据、查询参数和片段的 HTTP(S) 地址，尚未执行。');
  }
  // ChouYu has no verified per-model image capability declaration yet.
  if (needs.images) throw new Error('尚未验证此模型的 DSH 图片能力，尚未执行。');
  let baseURL = config.baseUrl.trim().replace(/\/+$/, '');
  if (config.provider === 'claude') {
    // Anthropic's SDK appends /v1/messages; ChouYu appends /messages itself.
    if (!url.pathname.replace(/\/+$/, '').endsWith('/v1')) throw new Error('此 Claude 端点路径暂不支持 DSH，尚未执行。');
    baseURL = baseURL.slice(0, -3);
  }
  return {
    profile: { providers: { chouyu: {
      api: config.provider === 'openai' ? 'openai-completions' : 'anthropic-messages',
      baseURL,
      apiKeyEnv: 'CHOUYU_DSH_API_KEY',
      models: [{ id: config.model.trim(), input: ['text'] }],
      retryPolicy: { mode: 'normal', maxRetries: 0 }
    } } },
    env: { CHOUYU_DSH_API_KEY: config.apiKey },
    capability: { text: true, tools: true, images: false }
  };
}
