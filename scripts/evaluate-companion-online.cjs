// Opt-in real model evaluation. Only synthetic task data is sent; no app is launched.
const fs = require('node:fs')
const path = require('node:path')
const { buildSync } = require('esbuild')
const root = path.resolve(__dirname, '..')
for (const name of ['CHOUYU_EVAL_BASE_URL', 'CHOUYU_EVAL_API_KEY', 'CHOUYU_EVAL_MODEL']) {
  if (!process.env[name]) throw new Error(`Missing ${name}`)
}
const directory = path.join(root, 'temp')
fs.mkdirSync(directory, { recursive: true })
const output = path.join(directory, 'companion-evaluation-runner.cjs')
buildSync({
  stdin: { contents: `import { evaluateCompanion } from './src/main/smoke/companion-evaluation'; import { DEFAULT_APP_CONFIG } from './src/shared/config'; export async function run() { const model=process.env.CHOUYU_EVAL_MODEL; return evaluateCompanion({...DEFAULT_APP_CONFIG,provider:process.env.CHOUYU_EVAL_PROVIDER || 'openai',baseUrl:process.env.CHOUYU_EVAL_BASE_URL,apiKey:process.env.CHOUYU_EVAL_API_KEY,model,thinkingDisabledModels:process.env.CHOUYU_EVAL_THINKING === 'enabled' ? [] : [model]}); }`, resolveDir: root, loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', outfile: output
})
require(output).run().then(result => {
  const report = path.join(directory, 'companion-online-results.json')
  fs.writeFileSync(report, JSON.stringify(result, null, 2))
  console.log(`Evaluation completed: ${report}. Review the actual summaries before accepting model quality.`)
}).catch(error => {
  console.error(String(error.message).replaceAll(process.env.CHOUYU_EVAL_API_KEY, '[redacted]'))
  process.exitCode = 1
})
