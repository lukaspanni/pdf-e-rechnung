import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const cloudPackage =
  /(?:@azure\/|@aws-sdk\/|aws-lambda|@cloudflare\/|vercel|netlify)/
const roots = [
  'packages/invoice-core',
  'packages/zugferd-adapter',
  'packages/einvoice-service',
  'packages/api-contract',
]

async function sources(path) {
  const entries = await readdir(path, { withFileTypes: true })
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const fullPath = join(path, entry.name)
        if (entry.isDirectory()) return sources(fullPath)
        return /\.[cm]?tsx?$/.test(entry.name) ? [fullPath] : []
      }),
    )
  ).flat()
}

const violations = []
for (const root of roots) {
  const manifest = JSON.parse(
    await readFile(join(root, 'package.json'), 'utf8'),
  )
  for (const section of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
  ]) {
    for (const name of Object.keys(manifest[section] ?? {})) {
      if (cloudPackage.test(name)) {
        violations.push(`${root}/package.json: ${section} includes ${name}`)
      }
    }
  }
  for (const file of await sources(root)) {
    const content = await readFile(file, 'utf8')
    for (const [index, line] of content.split('\n').entries()) {
      if (/\b(?:from|import)\s*[('\"]/.test(line) && cloudPackage.test(line)) {
        violations.push(`${file}:${index + 1}: ${line.trim()}`)
      }
    }
  }
}
if (violations.length) {
  console.error(
    `Cloud-import check failed (checks cloud SDK dependencies/imports in packages/*; does not check dependency direction or cycles):\n${violations.join('\n')}`,
  )
  process.exitCode = 1
}
