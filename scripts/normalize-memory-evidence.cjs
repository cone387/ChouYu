// Re-score saved synthetic results without calling any service or changing labels.
const fs = require('node:fs')
const { createHash } = require('node:crypto')
const [source, destination] = process.argv.slice(2)
if (!source || !destination || require('node:path').resolve(source) === require('node:path').resolve(destination)) throw new Error('Provide different source and destination report paths')
const input = fs.readFileSync(source)
const report = JSON.parse(input)
const results = report.evidenceSelection.results.map(result => {
  const expected = report.results.find(sample => sample.id === result.id).expected
  const rawSelected = result.rawSelected || result.selected
  const selected = [...new Set(rawSelected.map(id => id.replace(/^memory:/, '')))]
  return { ...result, rawSelected, selected, passed: !result.error && selected.length === expected.length && expected.every(id => selected.includes(id)) && (expected.length > 0 || result.answer === 'UNKNOWN') }
})
const output = { sourceSha256: createHash('sha256').update(input).digest('hex'), normalization: 'Only remove the literal memory: citation prefix. Expected IDs and answers are unchanged; no new provider requests.', rawPassed: report.evidenceSelection.passed, normalizedPassed: results.filter(result => result.passed).length, count: results.length, results }
fs.writeFileSync(destination, JSON.stringify(output, null, 2) + '\n')
console.log(`Evidence selection: raw ${output.rawPassed}/${output.count}; normalized ${output.normalizedPassed}/${output.count}`)
