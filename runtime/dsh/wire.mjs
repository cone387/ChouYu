import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';

/** Versioned, ordered, bounded full-duplex channel; SDK stdio remains untouched. */
export class RpcPeer {
  constructor(socket, onRequest, onClose = () => {}) {
    this.socket = socket; this.onRequest = onRequest; this.pending = new Map();
    this.sent = 0; this.received = 0; this.buffer = ''; this.closed = false;
    const decoder = new StringDecoder('utf8');
    socket.on('data', bytes => {
      try {
        this.buffer += decoder.write(bytes);
        let end;
        while ((end = this.buffer.indexOf('\n')) >= 0) {
          const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
          if (Buffer.byteLength(line) > 1024 * 1024) throw new Error('DSH 通信帧超限。');
          this.receive(JSON.parse(line));
        }
        if (Buffer.byteLength(this.buffer) > 1024 * 1024) throw new Error('DSH 通信帧超限。');
      } catch (error) { this.close(error); }
    });
    socket.on('error', error => this.close(error));
    socket.on('close', () => {
      this.closed = true;
      for (const { reject } of this.pending.values()) reject(new Error('DSH 通信已断开。'));
      this.pending.clear(); onClose();
    });
  }
  receive(packet) {
    if (!packet || packet.version !== 1 || packet.seq !== this.received + 1 || typeof packet.id !== 'string' || !['request', 'response'].includes(packet.type)) throw new Error('DSH 通信顺序或格式无效。');
    this.received = packet.seq;
    if (packet.type === 'response') {
      const pending = this.pending.get(packet.id);
      if (!pending) return; // a locally cancelled request may still have a late response
      this.pending.delete(packet.id);
      if (packet.error !== undefined) pending.reject(new Error(String(packet.error)));
      else pending.resolve(packet.value);
      return;
    }
    if (typeof packet.method !== 'string') throw new Error('DSH 通信方法无效。');
    Promise.resolve().then(() => this.onRequest(packet.method, packet.value)).then(
      value => this.send({ type: 'response', id: packet.id, value }),
      error => this.send({ type: 'response', id: packet.id, error: error instanceof Error ? error.message : 'DSH 请求失败。' })
    ).catch(error => this.close(error));
  }
  send(packet) {
    if (this.closed) throw new Error('DSH 通信已断开。');
    const line = JSON.stringify({ ...packet, version: 1, seq: ++this.sent }) + '\n';
    if (Buffer.byteLength(line) > 1024 * 1024 || this.socket.writableLength + Buffer.byteLength(line) > 8 * 1024 * 1024) {
      this.close(new Error('DSH 通信缓存超限。')); throw new Error('DSH 通信缓存超限。');
    }
    this.socket.write(line);
  }
  request(method, value, { signal, timeoutMs = 0 } = {}) {
    if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('DSH 请求已取消。'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', aborted); this.pending.delete(id); };
      const finish = fn => value => { cleanup(); fn(value); };
      const aborted = () => finish(reject)(signal?.reason ?? new Error('DSH 请求已取消。'));
      if (this.pending.size >= 256) { this.close(new Error('DSH 待处理请求超限。')); reject(new Error('DSH 待处理请求超限。')); return; }
      this.pending.set(id, { resolve: finish(resolve), reject: finish(reject) });
      signal?.addEventListener('abort', aborted, { once: true });
      if (timeoutMs) timer = setTimeout(() => finish(reject)(new Error('DSH 控制请求超时。')), timeoutMs);
      try { this.send({ type: 'request', id, method, value }); } catch (error) { finish(reject)(error); }
    });
  }
  close(error = new Error('DSH 通信已关闭。')) {
    if (this.closed) return;
    this.closed = true;
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear(); this.socket.destroy();
  }
}
