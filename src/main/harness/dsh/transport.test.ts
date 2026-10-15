import { afterEach, expect, it, vi } from 'vitest';
import { connect } from 'node:net';
import { once } from 'node:events';
import { DshTransport } from './transport';
import { RpcPeer } from '../../../../runtime/dsh/wire.mjs';
const cleanups: Array<() => unknown> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse())
    await cleanup(); });
it('rejects unauthorized clients, frame overflows and sequence gaps before business calls', async () => {
    const business = vi.fn(), transport = new DshTransport(business, () => { });
    cleanups.push(() => transport.close());
    const port = await transport.listen();
    const bad = new RpcPeer(connect(port, '127.0.0.1'), () => { });
    await expect(bad.request('hello', { role: 'plugin', token: 'wrong' })).rejects.toThrow();
    for (const frame of ['x'.repeat(1024 * 1024 + 1), JSON.stringify({ version: 1, seq: 2, id: 'bad', type: 'request', method: 'tool', value: {} }) + '\n']) {
        const socket = connect(port, '127.0.0.1');
        socket.on('error', () => { });
        const closed = new Promise<void>(resolve => socket.once('close', () => resolve()));
        await once(socket, 'connect');
        socket.write(frame);
        await closed;
    }
    expect(business).not.toHaveBeenCalled();
});
it('bounds unanswered requests and preserves abort reasons', async () => {
    const transport = new DshTransport(() => new Promise(() => { }), () => { });
    cleanups.push(() => transport.close());
    const port = await transport.listen(), peer = new RpcPeer(connect(port, '127.0.0.1'), () => { });
    cleanups.push(() => peer.close());
    await peer.request('hello', { role: 'plugin', token: transport.token });
    const abort = new AbortController(), pending = peer.request('wait', {}, { signal: abort.signal });
    abort.abort(new Error('chosen cancellation'));
    await expect(pending).rejects.toThrow('chosen cancellation');
    const requests = Array.from({ length: 257 }, () => peer.request('wait', {}).catch(e => e));
    await expect(requests.at(-1)).resolves.toBeInstanceOf(Error);
    peer.close();
    await Promise.all(requests);
});
