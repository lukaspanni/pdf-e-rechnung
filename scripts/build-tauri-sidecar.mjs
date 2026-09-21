import { copyFile, mkdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = process.env.TAURI_ENV_TARGET_TRIPLE ?? rustHostTriple()
assertCompatibleNodeTarget(target)
const extension = target.includes('windows') ? '.exe' : ''
const executable = resolve(
  root,
  'apps/desktop/src-tauri/binaries',
  `einvoice-api-${target}${extension}`,
)
const bundle = resolve(
  root,
  'apps/desktop/src-tauri/resources/einvoice-api.mjs',
)
const bunExecutable = process.platform === 'win32' ? 'bun.exe' : 'bun'

await mkdir(dirname(executable), { recursive: true })
await mkdir(dirname(bundle), { recursive: true })
await writeAppIcons()
const result = spawnSync(
  bunExecutable,
  [
    'build',
    'apps/api-azure/src/start-local-server.ts',
    '--target=node',
    // Factur-X's XML parser bundle expects these script-scope bindings.
    '--banner=var/**/abstractNode,HostPlatform',
    `--outfile=${bundle}`,
  ],
  { cwd: root, stdio: 'inherit' },
)
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
await copyFile(process.execPath, executable)

function rustHostTriple() {
  const result = spawnSync('rustc', ['-vV'], { encoding: 'utf8' })
  if (result.status !== 0)
    throw new Error('Could not determine Rust host target')
  const host = result.stdout.match(/^host: (.+)$/m)?.[1]
  if (!host) throw new Error('Rust did not report a host target')
  return host
}

function assertCompatibleNodeTarget(triple) {
  const currentOs = { win32: 'windows', darwin: 'darwin', linux: 'linux' }[
    process.platform
  ]
  const currentArch = { x64: 'x86_64', arm64: 'aarch64' }[process.arch]
  if (
    !currentOs ||
    !currentArch ||
    !triple.includes(currentOs) ||
    !triple.startsWith(currentArch)
  ) {
    throw new Error(
      `Bundled Node runtime does not match target ${triple}; build on the target OS and architecture.`,
    )
  }
}

async function writeAppIcons() {
  const iconPath = resolve(root, 'apps/desktop/src-tauri/icons/icon.ico')
  await mkdir(dirname(iconPath), { recursive: true })
  const size = 64
  const pixels = Buffer.alloc(size * size * 4)
  const color = (x, y) => {
    if (x >= 14 && x < 50 && y >= 7 && y < 57) {
      if (x >= 40 && y < 17 && x + y >= 53) return [206, 211, 209, 255]
      if (
        [23, 31, 39, 47].some(
          (line) =>
            y >= line && y < line + 3 && x >= 21 && x < (line === 47 ? 39 : 43),
        )
      ) {
        return [39, 54, 60, 255]
      }
      return [248, 246, 238, 255]
    }
    return [35, 48, 55, 255]
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4
      pixels.set(color(x, y), offset)
    }
  }
  const png = encodePng(size, size, pixels)
  const header = Buffer.alloc(22)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)
  header.writeUInt8(size, 6)
  header.writeUInt8(size, 7)
  header.writeUInt16LE(1, 10)
  header.writeUInt16LE(32, 12)
  header.writeUInt32LE(png.length, 14)
  header.writeUInt32LE(header.length, 18)
  const { writeFile } = await import('node:fs/promises')
  await Promise.all([
    writeFile(iconPath, Buffer.concat([header, png])),
    writeFile(resolve(dirname(iconPath), 'icon.png'), png),
    writeFile(resolve(dirname(iconPath), 'icon.icns'), encodeIcns(png)),
  ])
}

function encodeIcns(png) {
  const chunk = Buffer.alloc(png.length + 8)
  chunk.write('icp6', 0)
  chunk.writeUInt32BE(chunk.length, 4)
  png.copy(chunk, 8)
  const header = Buffer.alloc(8)
  header.write('icns', 0)
  header.writeUInt32BE(chunk.length + header.length, 4)
  return Buffer.concat([header, chunk])
}

function encodePng(width, height, rgba) {
  const scanlines = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    rgba.copy(
      scanlines,
      y * (width * 4 + 1) + 1,
      y * width * 4,
      (y + 1) * width * 4,
    )
  }
  const chunk = (type, data) => {
    const output = Buffer.alloc(data.length + 12)
    output.writeUInt32BE(data.length, 0)
    output.write(type, 4)
    data.copy(output, 8)
    output.writeUInt32BE(crc32(output.subarray(4, -4)), output.length - 4)
    return output
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(scanlines)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}
