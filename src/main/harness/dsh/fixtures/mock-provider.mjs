import { createServer } from 'node:http';
/** Wire-level fixture: actual SDK/adapter requests, no replacement of the agent loop. */
export async function startMockProvider(provider, options = {}) {
    const requests = [];
    const server = createServer(async (req, res) => {
        const buffers = [];
        for await (const part of req)
            buffers.push(part);
        const body = JSON.parse(Buffer.concat(buffers).toString());
        requests.push({ path: req.url, headers: req.headers, body });
        if (options.failure) {
            res.writeHead(options.failure.status, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: { message: options.failure.message, type: 'fixture_error' } }));
            return;
        }
        if (options.holdText && JSON.stringify(body.messages).includes(options.holdText))
            return;
        const tool = options.tools === 'always' || options.tools !== false && requests.length === 1;
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        const event = (type, data) => res.write(`${type ? `event: ${type}\n` : ''}data: ${JSON.stringify(data)}\n\n`);
        if (provider === 'openai') {
            const chunk = (delta, finish_reason = null) => event('', { id: 'fixture-message', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }] });
            chunk({ role: 'assistant' });
            if (tool)
                chunk({ tool_calls: [{ index: 0, id: 'fixture-call', type: 'function', function: { name: 'chouyu_fixture', arguments: '{"value":"synthetic"}' } }] });
            else {
                chunk({ content: options.text ?? 'DSH_' });
                if (!options.text) chunk({ content: 'OK' });
            }
            chunk({}, tool ? 'tool_calls' : options.truncated ? 'length' : 'stop');
            if (!options.omitUsage) event('', { id: 'fixture-message', object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } });
            res.write('data: [DONE]\n\n');
        }
        else {
            event('message_start', { type: 'message_start', message: { id: 'fixture-message', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 11, output_tokens: 0 } } });
            event('content_block_start', { type: 'content_block_start', index: 0, content_block: tool ? { type: 'tool_use', id: 'fixture-call', name: 'chouyu_fixture', input: {} } : { type: 'text', text: '' } });
            for (const text of tool ? ['{"value":"synthetic"}'] : ['DSH_', 'OK'])
                event('content_block_delta', { type: 'content_block_delta', index: 0, delta: tool ? { type: 'input_json_delta', partial_json: text } : { type: 'text_delta', text } });
            event('content_block_stop', { type: 'content_block_stop', index: 0 });
            event('message_delta', { type: 'message_delta', delta: { stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 7 } });
            event('message_stop', { type: 'message_stop' });
        }
        res.end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, requests, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}
