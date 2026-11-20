// Gives the Mac app an ad-hoc signature. Without any signature, Apple silicon Macs call a
// downloaded app "damaged". With it, people see the normal "unidentified developer"
// prompt and can open it with right-click → Open. Replace with a Developer ID later.
const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
}
