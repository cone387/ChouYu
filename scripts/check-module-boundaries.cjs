const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const slash = value => value.replaceAll('\\', '/')
const domains = /^src\/main\/(agents|agent-space|task-center|assistant-routines|tasks|reminders|memory|journal|chat|harness|skills)\//
const pages = /^src\/renderer\/src\/components\/(Tasks|Journal|Settings|Contacts|ChatPanel)\//
const entrypoints = new Set(['Tasks/TasksView', 'Journal/Journal', 'Settings/Settings', 'Contacts/ContactsView', 'ChatPanel/ChatPanel'])
// Exact legacy edges may be listed here with a reason; never exempt a whole directory.
const allowed = new Map()

function imports(file, source) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const specifiers = []
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) specifiers.push(node.moduleSpecifier.text)
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) specifiers.push(node.argument.literal.text)
    else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require') && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])) specifiers.push(node.arguments[0].text)
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return specifiers.map(specifier => {
    if (specifier.startsWith('.')) return path.posix.normalize(path.posix.join(path.posix.dirname(slash(file)), specifier)).replace(/\.(tsx?|jsx?)$/, '')
    // Vite's renderer alias resolves to source, not an external package.
    if (specifier.startsWith('@renderer/')) return 'src/renderer/src/' + specifier.slice(10)
    if (specifier.startsWith('@/')) return 'src/renderer/src/' + specifier.slice(2)
    return specifier
  })
}

function checkSource(file, source) {
  const from = slash(file)
  return imports(from, source).flatMap(to => {
    let reason = ''
    if (from.startsWith('src/shared/') && /^src\/(main|renderer|preload)(\/|$)/.test(to)) reason = 'shared must not depend on application layers'
    else if (from.startsWith('src/shared/') && to === 'electron') reason = 'shared contracts must not depend on Electron'
    else if (domains.test(from) && /^src\/main\/ipc(\/|$)/.test(to)) reason = 'domain must not import IPC registration'
    else if (domains.test(from) && /^src\/renderer(\/|$)/.test(to)) reason = 'main domain must not depend on renderer'
    else if (pages.test(from)) {
      const target = to.replace('src/renderer/src/components/', '')
      if (entrypoints.has(target) && from.split('/')[4] !== target.split('/')[0]) reason = 'business pages are composed by Workspace'
    }
    return reason && !allowed.has(from + ' -> ' + to) ? [{ from, to, reason }] : []
  })
}

function checkRepository(root = process.cwd()) {
  const errors = []
  function walk(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, item.name)
      if (item.isDirectory()) walk(full)
      else if (/\.[cm]?[jt]sx?$/.test(item.name) && !/\.(test|spec)\./.test(item.name)) errors.push(...checkSource(slash(path.relative(root, full)), fs.readFileSync(full, 'utf8')))
    }
  }
  walk(path.join(root, 'src'))
  return errors
}
module.exports = { imports, checkSource, checkRepository }
if (require.main === module) {
  const errors = checkRepository()
  for (const edge of errors) console.error(`${edge.from} -> ${edge.to}: ${edge.reason}`)
  if (errors.length) process.exitCode = 1
  else console.log('Module boundaries passed (TypeScript import graph).')
}
