import { appendFileSync } from 'node:fs';
// Resolve the isolated runtime dependency tree, never a global or sibling checkout.
const { defineTool } = await import('../../../../../runtime/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js');
export const name = 'chouyu-provider-probe';
export const inject = ['tools', 'agents'];
export function apply(ctx) {
  const record = data => appendFileSync(process.env.CHOUYU_DSH_PROBE_EVENTS, JSON.stringify(data) + '\n');
  ctx.on('agent/assistant-stream', ({ frame }) => record({ kind: 'stream', frame }));
  ctx.tools.register(defineTool({
    name: 'chouyu_fixture', description: 'Return the synthetic fixture receipt.',
    parameters: { value: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) { record({ kind: 'tool', args }); return 'fixture-result'; }
  }));
}
