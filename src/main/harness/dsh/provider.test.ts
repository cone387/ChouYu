import { describe, expect, it } from 'vitest';
import { mapProvider } from '../../../../runtime/dsh/provider.mjs';
describe('ChouYu provider mapping', () => {
    it.each([
        ['openai', 'openai-completions'],
        ['claude', 'anthropic-messages']
    ] as const)('preserves %s model, endpoint and credentials without substitution', (provider, api) => {
        const mapped = mapProvider({ provider, baseUrl: 'http://127.0.0.1:3344/v1/', apiKey: 'fixture-key', model: 'custom-model' }, { tools: true, images: false });
        expect(mapped.profile.providers.chouyu).toMatchObject({
            api, baseURL: provider === 'claude' ? 'http://127.0.0.1:3344' : 'http://127.0.0.1:3344/v1', apiKeyEnv: 'CHOUYU_DSH_API_KEY',
            models: [{ id: 'custom-model' }]
        });
        expect(mapped.env).toEqual({ CHOUYU_DSH_API_KEY: 'fixture-key' });
        expect(JSON.stringify(mapped.profile)).not.toContain('fixture-key');
    });
    it('rejects missing credentials before a model request can be constructed', () => {
        expect(() => mapProvider({ provider: 'openai', baseUrl: 'https://example.com/v1', apiKey: ' ', model: 'model' }, { tools: true, images: false })).toThrow(/密钥/);
    });
    it('refuses persisted encrypted credentials outside the main process resolver', () => {
        expect(() => mapProvider({ provider: 'openai', baseUrl: 'https://example.com/v1', apiKey: 'safe:v1:encrypted-fixture', model: 'm' }, { tools: true, images: false })).toThrow(/密钥/);
    });
    it.each(['file:///C:/secrets', 'https://user:pass@example.com/v1', 'https://example.com/v1?key=secret', 'http://example.com/#fragment'])('rejects unsafe or ambiguous endpoint %s', baseUrl => {
        expect(() => mapProvider({ provider: 'openai', baseUrl, apiKey: 'fixture-key', model: 'model' }, { tools: false, images: false })).toThrow(/端点/);
    });
    it('does not guess image capability for an unknown model', () => {
        expect(() => mapProvider({ provider: 'openai', baseUrl: 'https://example.com/v1', apiKey: 'fixture-key', model: 'unknown-model' }, { tools: true, images: true })).toThrow(/图片/);
    });
    it('refuses a Claude endpoint whose path cannot be preserved by the SDK', () => {
        expect(() => mapProvider({ provider: 'claude', baseUrl: 'https://example.com/custom', apiKey: 'fixture-key', model: 'm' }, { tools: true, images: false })).toThrow(/端点/);
    });
    it('does not substitute a default model or unsupported provider', () => {
        const config = { provider: 'openai' as const, baseUrl: 'https://example.com/v1', apiKey: 'fixture-key', model: '' };
        expect(() => mapProvider(config, { tools: true, images: false })).toThrow(/模型/);
        expect(() => mapProvider({ ...config, provider: 'other' as 'openai', model: 'm' }, { tools: false, images: false })).toThrow(/供应商/);
    });
});
