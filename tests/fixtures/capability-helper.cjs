const readline = require('node:readline')
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line)
  const mode = request.params?.mode
  if (mode === 'timeout') return
  if (mode === 'crash') return process.exit(2)
  if (mode === 'malformed') return process.stdout.write('not-json\n')
  if (mode === 'oversize') return process.stdout.write('x'.repeat(1000001))
  const result = request.method === 'initialize' ? { protocolVersion: 1 } : { text: '中文响应', inheritedSecret: Boolean(process.env.CHOUYU_TEST_SECRET), inheritedNodeOptions: Boolean(process.env.NODE_OPTIONS) }
  setTimeout(() => {
    const encoded = JSON.stringify({ id: request.id, ok: true, result }) + '\n'
    const bytes = Buffer.from(encoded)
    const split = bytes.indexOf(Buffer.from('中')) + 1
    process.stdout.write(bytes.subarray(0, split))
    process.stdout.write(bytes.subarray(split))
  }, request.params?.delay || 0)
})
