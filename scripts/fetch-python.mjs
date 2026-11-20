// Downloads a self-contained Python for one platform into runtime/<os>-<arch>/python and
// installs the packages macros need. electron-builder copies it into the app.
//   node scripts/fetch-python.mjs              (this computer)
//   node scripts/fetch-python.mjs win x64      (another target; run pip on that system or CI)
import { execFileSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'

const RELEASE = '20241016'
const PY = '3.12.7'
const TRIPLES = {
  'mac-arm64': 'aarch64-apple-darwin',
  'mac-x64': 'x86_64-apple-darwin',
  'win-x64': 'x86_64-pc-windows-msvc',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu'
}
const PACKAGES = ['pynput==1.7.7', 'mss==9.0.2', 'pillow==11.0.0', 'numpy==2.1.3']

const os = process.argv[2] ?? { darwin: 'mac', win32: 'win', linux: 'linux' }[process.platform]
const arch = process.argv[3] ?? process.arch
const triple = TRIPLES[`${os}-${arch}`]
if (!triple) {
  console.error(`No Python build for ${os}-${arch}. Options: ${Object.keys(TRIPLES).join(', ')}`)
  process.exit(1)
}

const dest = join('runtime', `${os}-${arch}`)
rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })
const file = `cpython-${PY}+${RELEASE}-${triple}-install_only.tar.gz`
const url = `https://github.com/astral-sh/python-build-standalone/releases/download/${RELEASE}/${encodeURIComponent(file)}`
console.log(`Downloading ${file}`)
const res = await fetch(url)
if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`)
const tarball = join(dest, 'python.tar.gz')
await pipeline(res.body, createWriteStream(tarball))
execFileSync('tar', ['-xzf', tarball, '-C', dest], { stdio: 'inherit' })
rmSync(tarball)

const exe = os === 'win' ? join(dest, 'python', 'python.exe') : join(dest, 'python', 'bin', 'python3')
const sameSystem = os === { darwin: 'mac', win32: 'win', linux: 'linux' }[process.platform] && arch === process.arch
if (sameSystem && existsSync(exe)) {
  console.log('Installing macro packages')
  execFileSync(exe, ['-m', 'pip', 'install', '--no-cache-dir', '--disable-pip-version-check', ...PACKAGES], { stdio: 'inherit' })
  execFileSync(exe, ['-I', join('python', 'luger_entry.py'), 'tool', 'check'], { input: JSON.stringify({ source: 'import luger' }), stdio: ['pipe', 'inherit', 'inherit'] })
  console.log(`\nReady: ${exe}`)
} else {
  console.log(`Extracted to ${dest}. Run this script on a ${os} ${arch} machine (or in CI) to install the packages.`)
}
