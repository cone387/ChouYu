import { expect, it } from 'vitest';
import { DEFAULT_APP_CONFIG } from '../../shared/config';
import { prepareHarnessInput } from './prepare';
it('preserves order, roles and snapshot independently of subsequent edits', async () => {
    const request = { requestId: 'r1', characterId: 'c1', sessionId: 's1', systemPrompt: '', messages: [{ role: 'user' as const, content: 'old' }, { role: 'assistant' as const, content: 'previous' }, { role: 'user' as const, content: 'edited latest' }] };
    const config = { ...DEFAULT_APP_CONFIG, soulMd: '', model: 'test-model' };
    const input = await prepareHarnessInput(request, { config, signal: new AbortController().signal, assertContext: async () => { }, citationContext: async () => 'reference', privateContext: '', skillContext: '', communication: 'shared rules' });
    request.messages[2].content = 'later edit';
    config.model = 'later model';
    expect(input.messages.map(m => [m.role, m.content])).toEqual([['user', 'old'], ['assistant', 'previous'], ['user', 'edited latest']]);
    expect(input.systemPrompt).toBe('shared rules');
    expect(input.config.model).toBe('test-model');
    expect(input.attemptId).toBeTruthy();
});
it('rejects revoked current citations but retains a missing-reference marker on old messages', async () => {
    const ref = { ref: { characterId: 'c1', topicId: 't1', version: 1, sectionId: 's' }, title: 'source' } as never;
    const context = { config: DEFAULT_APP_CONFIG, signal: new AbortController().signal, assertContext: async () => { }, citationContext: async () => { throw new Error('revoked'); }, privateContext: '', skillContext: '', communication: '' };
    const request = { requestId: 'r', characterId: 'c1', sessionId: 's1', systemPrompt: '', messages: [{ role: 'user' as const, content: 'current', contactCitations: [ref] }] };
    await expect(prepareHarnessInput(request, context)).rejects.toThrow('revoked');
    request.messages.push({ role: 'user', content: 'new current', contactCitations: [] });
    const input = await prepareHarnessInput(request, context);
    expect(input.messages[0].content).toContain('历史消息引用的正文已移除');
    expect(input.messages[1].content).toBe('new current');
});
