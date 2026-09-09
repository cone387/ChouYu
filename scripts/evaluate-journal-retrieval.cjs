// Only the checked-in synthetic corpus is read. Default mode never makes network requests.
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const root = path.resolve(__dirname, '..')
function bundled(relative) {
  const filename = path.join(root, relative)
  const result = require('esbuild').buildSync({ entryPoints: [filename], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' })
  const compiled = new Module(filename, module)
  compiled.filename = filename
  compiled.paths = module.paths
  compiled._compile(result.outputFiles[0].text, filename)
  return compiled.exports
}
async function main() {
  const args = process.argv.slice(2)
  if (args.some(arg => arg !== '--live')) throw new Error('Usage: npm run test:journal-retrieval -- [--live]')
  const corpus = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/journal-retrieval.json'), 'utf8'))
  const { prepareRetrievalEvaluation, evaluateJournalRetrieval } = bundled('src/main/evaluation/journal-retrieval.ts')
  const preview = prepareRetrievalEvaluation(corpus)
  if (!args.includes('--live')) {
    console.log(JSON.stringify({ mode: 'dry-run', scope: 'Synthetic labeled corpus; no model quality measured and no network requests.', corpusHash: preview.corpusHash, cases: preview.cases.length, texts: preview.texts.length, characters: preview.texts.reduce((sum, text) => sum + text.length, 0), batches: Math.ceil(preview.texts.length / 32) }, null, 2))
    return
  }
  const baseUrl = process.env.CHOUYU_EVAL_EMBEDDING_URL, apiKey = process.env.CHOUYU_EVAL_EMBEDDING_KEY, model = process.env.CHOUYU_EVAL_EMBEDDING_MODEL
  if (!baseUrl || !apiKey || !model) throw new Error('Live mode requires CHOUYU_EVAL_EMBEDDING_URL, CHOUYU_EVAL_EMBEDDING_KEY and CHOUYU_EVAL_EMBEDDING_MODEL')
  const url = new URL(baseUrl)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid evaluation endpoint')
  const { OpenAIEmbeddingClient } = bundled('src/main/memory/embedding-client.ts')
  const client = new OpenAIEmbeddingClient({ baseUrl, apiKey, model })
  const signal = AbortSignal.timeout(300_000)
  const report = await evaluateJournalRetrieval(corpus, texts => client.embed(texts, signal))
  console.log(JSON.stringify({ mode: 'live', createdAt: new Date().toISOString(), service: url.origin + url.pathname, model, scope: 'Small synthetic corpus, not production recall or a calibrated no-answer detector.', ...report }, null, 2))
}
main().catch(() => { console.error('Journal retrieval evaluation failed. Check corpus, required environment variables and service availability. Provider response and credentials omitted.'); process.exitCode = 1 })
