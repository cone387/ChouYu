import type { AppConfig } from '../shared/config'
import { isAIConfigured } from '../shared/config'
import { joinApiUrl, type AIModelListErrorCode, type AIModelListResult, type ProviderDiagnostics } from '../shared/ai'
import { OpenAIEmbeddingClient } from './memory/embedding-client'
import { probeConversation } from './provider-probe'

const MODEL_LIST_TIMEOUT_MS = 10_000

function getModelEndpointCandidates(baseUrl: string): Array<{ baseUrl: string; url: string }> {
  const normalizedBase = baseUrl.trim().replace(/\/+$/, '')
  const candidates = [{ baseUrl: normalizedBase, url: joinApiUrl(normalizedBase, 'models') }]
  if (!/\/v1$/i.test(normalizedBase)) {
    const v1BaseUrl = `${normalizedBase}/v1`
    candidates.push({ baseUrl: v1BaseUrl, url: joinApiUrl(v1BaseUrl, 'models') })
  }
  return candidates
}

function extractModelIds(value: unknown): string[] {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : null
  const source = Array.isArray(value)
    ? value
    : Array.isArray(record?.data)
      ? record.data
      : Array.isArray(record?.models)
        ? record.models
        : null
  if (!source) return []
  return Array.from(new Set(source
    .map((item) => {
      if (typeof item === 'string') return item.trim()
      if (!item || typeof item !== 'object') return ''
      const model = item as Record<string, unknown>
      const id = typeof model.id === 'string' ? model.id : typeof model.name === 'string' ? model.name : ''
      return id.trim()
    })
    .filter(Boolean)))
}

function modelListFailure(
  config: AppConfig,
  errorCode: AIModelListErrorCode,
  message: string,
  httpStatus?: number
): AIModelListResult {
  return {
    ok: false,
    models: [],
    baseUrl: config.baseUrl.trim(),
    baseUrlAdjusted: false,
    configuredModelValid: false,
    httpStatus,
    errorCode,
    message
  }
}

export async function fetchProviderModels(
  config: AppConfig,
  request: typeof fetch = fetch
): Promise<AIModelListResult> {
  if (!config.baseUrl.trim()) {
    return modelListFailure(config, 'missing-base-url', '请先填写 Base URL。')
  }
  if (!config.apiKey.trim()) {
    return modelListFailure(config, 'missing-api-key', '请先填写 API Key。')
  }

  let candidates: Array<{ baseUrl: string; url: string }>
  try {
    candidates = getModelEndpointCandidates(config.baseUrl)
  } catch (error) {
    return modelListFailure(config, 'invalid-url', error instanceof Error ? error.message : 'Base URL 格式无效。')
  }

  const headers = config.provider === 'claude'
    ? { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' }
    : { Authorization: `Bearer ${config.apiKey}` }
  const failures: AIModelListResult[] = []

  for (const candidate of candidates) {
    try {
      const response = await request(candidate.url, {
        headers,
        signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS)
      })
      if (!response.ok) {
        const errorCode: AIModelListErrorCode = response.status === 401 || response.status === 403
          ? 'authentication'
          : response.status === 404
            ? 'endpoint-not-found'
            : 'invalid-response'
        const message = errorCode === 'authentication'
          ? `认证失败（HTTP ${response.status}），请检查 API Key。`
          : errorCode === 'endpoint-not-found'
            ? `没有找到模型接口（HTTP ${response.status}）。`
            : `模型接口返回 HTTP ${response.status}。`
        failures.push(modelListFailure(config, errorCode, message, response.status))
        continue
      }

      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        failures.push(modelListFailure(config, 'invalid-response', '模型接口返回的不是 JSON，Base URL 可能缺少 /v1。', response.status))
        continue
      }
      const models = extractModelIds(payload)
      if (models.length === 0) {
        failures.push(modelListFailure(config, 'invalid-response', '接口已连接，但响应中没有可识别的模型列表。', response.status))
        continue
      }

      const originalBaseUrl = config.baseUrl.trim().replace(/\/+$/, '')
      const baseUrlAdjusted = candidate.baseUrl !== originalBaseUrl
      return {
        ok: true,
        models,
        baseUrl: candidate.baseUrl,
        baseUrlAdjusted,
        configuredModelValid: models.includes(config.model),
        httpStatus: response.status,
        message: baseUrlAdjusted
          ? `连接成功，已自动将 Base URL 修正为 ${candidate.baseUrl}。`
          : `连接成功，已获取 ${models.length} 个模型。`
      }
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
      failures.push(modelListFailure(
        config,
        'network',
        timedOut ? '连接超时，请检查服务地址和网络。' : '无法连接服务，请检查 Base URL 和网络。'
      ))
    }
  }

  return failures.find((failure) => failure.errorCode === 'authentication')
    ?? failures.find((failure) => failure.errorCode === 'network')
    ?? failures[failures.length - 1]
    ?? modelListFailure(config, 'invalid-response', '未获取到可用模型。')
}

export async function diagnoseProvider(
  config: AppConfig,
  request: typeof fetch = fetch
): Promise<ProviderDiagnostics> {
  const modelList = await fetchProviderModels(config, request)
  const configured = isAIConfigured(config)
  const conversation = await probeConversation(config, request)
  let embedding: ProviderDiagnostics['embedding']
  if (!config.embeddingEnabled || config.embeddingProvider === 'none') {
    embedding = { state: 'disabled', provider: 'none', model: config.embeddingModel, message: '未启用 Embedding；记忆检索使用关键词模式。' }
  } else if (config.embeddingProvider !== 'openai-compatible') {
    embedding = { state: 'error', provider: config.embeddingProvider, model: config.embeddingModel, message: '当前 Embedding 能力插件未安装。' }
  } else if (!config.embeddingModel.trim()) {
    embedding = { state: 'unconfigured', provider: config.embeddingProvider, model: '', message: '尚未配置 Embedding 模型。' }
  } else {
    const baseUrl = config.embeddingBaseUrl || config.baseUrl
    const apiKey = config.embeddingApiKey || config.apiKey
    if (!baseUrl.trim() || !apiKey.trim()) {
      embedding = { state: 'unconfigured', provider: config.embeddingProvider, model: config.embeddingModel, message: 'Embedding 复用当前 Provider，需要先完成 AI 配置。' }
    } else {
      try {
        const vectors = await new OpenAIEmbeddingClient({ baseUrl, apiKey, model: config.embeddingModel }, request).embed(['ChouYu embedding capability probe'])
        embedding = { state: 'ready', provider: config.embeddingProvider, model: config.embeddingModel, dimensions: vectors[0]?.length, message: `Embedding 可用，向量维度 ${vectors[0]?.length || 0}。` }
      } catch (error) {
        embedding = { state: 'error', provider: config.embeddingProvider, model: config.embeddingModel, message: error instanceof Error ? error.message : 'Embedding 接口不可用。' }
      }
    }
  }
  const state: ProviderDiagnostics['state'] = !configured ? 'unconfigured' : conversation.state
  const message = state === 'unconfigured'
    ? 'AI Provider 尚未完成配置。'
    : state === 'ready'
      ? '当前模型已通过真实对话测试。'
      : conversation.message
  return { state, message, modelList, embedding, conversation }
}
