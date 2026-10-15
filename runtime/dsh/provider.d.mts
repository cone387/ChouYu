import type { AppConfig } from '../../src/shared/config'
export interface MappedProvider {
  profile: { providers: { chouyu: {
    api: 'openai-completions' | 'anthropic-messages'; baseURL: string; apiKeyEnv: string;
    models: Array<{ id: string; input: string[] }>;
    retryPolicy: { mode: 'normal'; maxRetries: number }
  } } }
  env: Record<string, string>
  capability: { text: boolean; tools: boolean; images: boolean }
}
export function mapProvider(config: Pick<AppConfig, 'provider' | 'baseUrl' | 'apiKey' | 'model'>, needs: { tools: boolean; images: boolean }): MappedProvider
