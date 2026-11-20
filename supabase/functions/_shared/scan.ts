// Server-side malware scan for Explore uploads. Mirrors the app's Python scanner rules,
// working on text because the server cannot run Python. Anything flagged is held for staff.

const NETWORK = ['socket', 'ssl', 'http', 'urllib', 'urllib2', 'urllib3', 'requests', 'httpx', 'aiohttp', 'ftplib', 'smtplib',
  'poplib', 'imaplib', 'telnetlib', 'xmlrpc', 'websocket', 'websockets', 'paramiko', 'discord', 'dhooks', 'pycurl', 'asyncio',
  'selectors', 'socketserver', 'webbrowser']
const PROCESS = ['subprocess', 'multiprocessing', 'pty', 'pexpect', 'sh']
const NATIVE = ['ctypes', 'cffi', '_ctypes', 'winreg', '_winreg', 'win32api', 'win32con', 'win32crypt', 'win32process', 'mmap', 'msvcrt']
const RISKY = ['pickle', 'marshal', 'shelve', 'importlib', 'imp', 'runpy', 'code', 'codeop', 'zipimport', 'pkgutil', 'builtins',
  'browser_cookie3', 'Crypto', 'Cryptodome', 'keyring', 'pyperclip', 'shutil', 'tempfile', 'sqlite3', 'glob', 'pathlib']
const ALLOWED = ['luger', 'time', 'math', 'random', 're', 'json', 'datetime', 'itertools', 'functools', 'collections',
  'dataclasses', 'enum', 'typing', 'statistics', 'string', 'threading', 'numpy', 'PIL', 'copy', 'operator', 'decimal',
  'fractions', 'heapq', 'bisect', 'textwrap', '__future__', 'os', 'sys']
const SENSITIVE: [RegExp, string][] = [
  [/roblosecurity|robloxcookies|rbx-cookie/i, 'Roblox login cookie'],
  [/discord(app)?\.com\/api\/(v\d+\/)?webhooks/i, 'Discord webhook (data exfiltration)'],
  [/api\.telegram\.org\/bot/i, 'Telegram bot (data exfiltration)'],
  [/local state|login data|web data|\\network\\cookies/i, 'Browser password or cookie store'],
  [/leveldb|discord\\local storage|discordcanary|discordptb/i, 'Discord token store'],
  [/wallet\.dat|exodus|metamask|electrum/i, 'Crypto wallet'],
  [/pastebin\.com\/raw|transfer\.sh|anonfiles|gofile\.io|ngrok/i, 'Remote payload host'],
  [/schtasks|reg add|currentversion\\run|launchagents|crontab|systemctl/i, 'Persistence (auto-start)'],
  [/powershell|cmd\.exe|\/bin\/sh|\/bin\/bash|-encodedcommand/i, 'Shell execution']
]

export type Finding = { line: number; rule: string; severity: 'low' | 'medium' | 'high'; message: string }

function entropy(s: string): number {
  const counts = new Map<string, number>()
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1)
  let e = 0
  for (const n of counts.values()) e -= (n / s.length) * Math.log2(n / s.length)
  return e
}

function tryDecode(text: string, depth = 0): string[] {
  if (depth > 3 || text.length < 24) return []
  const out: string[] = []
  const attempts: string[] = []
  if (/^[A-Za-z0-9+/=_-]+$/.test(text)) {
    try {
      attempts.push(atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4)))
    } catch { /* not base64 */ }
  }
  if (/^[0-9a-fA-F]+$/.test(text) && text.length % 2 === 0) {
    attempts.push(text.match(/../g)!.map((h) => String.fromCharCode(parseInt(h, 16))).join(''))
  }
  for (const a of attempts) {
    const printable = [...a].filter((c) => c >= ' ' || '\n\t\r'.includes(c)).length / Math.max(1, a.length)
    if (printable > 0.95) {
      out.push(a)
      out.push(...tryDecode(a.trim(), depth + 1))
    } else if (a.charCodeAt(0) === 0x78) {
      out.push('\u0000zlib') // compressed payload: cannot inflate synchronously, flag it
    }
  }
  return out
}

export function scanPython(source: string, depth = 0): { verdict: 'clean' | 'suspicious' | 'malicious'; findings: Finding[] } {
  const findings: Finding[] = []
  const lines = source.split('\n')
  const add = (line: number, rule: string, severity: Finding['severity'], message: string) => findings.push({ line, rule, severity, message })
  const blocked = new Map<string, string>()

  lines.forEach((raw, i) => {
    const n = i + 1
    const line = raw.replace(/#.*$/, '')
    const imp = line.match(/^\s*import\s+(.+)$/) ?? line.match(/^\s*from\s+([\w.]+)\s+import\s+(.+)$/)
    if (imp) {
      const mods = line.trimStart().startsWith('from') ? [imp[1]] : imp[1].split(',').map((m) => m.trim().split(/\s+as\s+/)[0])
      for (const m of mods) {
        const root = m.split('.')[0]
        const alias = line.match(new RegExp(`${m.replace('.', '\\.')}\\s+as\\s+(\\w+)`))?.[1] ?? root
        if (NETWORK.includes(root)) { add(n, 'network', 'high', `Uses the network (${m})`); blocked.set(alias, 'network') }
        else if (PROCESS.includes(root)) { add(n, 'process', 'high', `Starts other programs (${m})`); blocked.set(alias, 'process') }
        else if (NATIVE.includes(root)) { add(n, 'native', 'high', `Calls native system code (${m})`); blocked.set(alias, 'native') }
        else if (RISKY.includes(root)) add(n, 'module', 'medium', `Uses a module macros should not need (${m})`)
        else if (!ALLOWED.includes(root)) add(n, 'unknown_module', 'medium', `Imports an unknown module (${m})`)
      }
    }
    if (/(^|[^\w.])(eval|exec|compile|__import__|execfile|breakpoint)\s*\(/.test(line)) add(n, 'dynamic_code', 'high', 'Runs generated code')
    if (/\bos\.(system|popen|startfile|fork|exec\w*|spawn\w*)\s*\(/.test(line)) add(n, 'os_call', 'high', 'Starts other programs through os')
    if (/\bos\.(remove|unlink|rmdir|removedirs|rename|replace|walk|listdir|scandir|getenv|environ|chmod|makedirs)\b/.test(line)) add(n, 'os_call', 'medium', 'Touches files or settings through os')
    if (/__(globals|builtins|subclasses|code|bases|mro)__|\bf_globals\b|\bf_back\b/.test(line)) add(n, 'introspection', 'high', 'Reaches into interpreter internals')
    if (/\bopen\s*\([^)]*,\s*['"][^'"]*[wax+]/.test(line)) add(n, 'file_write', 'medium', 'Writes files')
    for (const [alias, rule] of blocked) {
      if (new RegExp(`\\b${alias}\\s*\\.`).test(line) && !imp) add(n, rule, 'high', `Calls ${alias}`)
    }
    if (raw.length > 800) add(n, 'long_line', 'medium', 'Has an extremely long line (common in obfuscated code)')
    for (const m of raw.matchAll(/(['"])((?:\\.|(?!\1).)*)\1/g)) {
      const s = m[2]
      const hit = SENSITIVE.find(([re]) => re.test(s))
      if (hit) add(n, 'sensitive', 'high', `References ${hit[1]}`)
      if (s.length >= 200 && entropy(s) > 4.6) add(n, 'entropy', 'medium', 'Contains a large encoded blob')
      if (depth < 2) {
        for (const d of tryDecode(s)) {
          if (d === '\u0000zlib') add(n, 'hidden_code', 'high', 'Hides compressed data in a string')
          else if (/\b(import|exec|eval|def|lambda)\b/.test(d)) {
            add(n, 'hidden_code', 'high', 'Hides Python code inside a string')
            for (const f of scanPython(d, depth + 1).findings) if (f.severity === 'high') add(n, f.rule, 'high', 'Hidden: ' + f.message)
          } else if (SENSITIVE.some(([re]) => re.test(d))) add(n, 'hidden_string', 'high', 'Hides a sensitive string in encoded form')
        }
      }
    }
  })
  const seen = new Set<string>()
  const unique = findings.filter((f) => {
    const k = `${f.line}|${f.rule}|${f.message}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  const verdict = unique.some((f) => f.severity === 'high') ? 'malicious' : unique.some((f) => f.severity === 'medium') ? 'suspicious' : 'clean'
  return { verdict, findings: unique }
}

/** Explore only takes Python. Reject anything that is clearly AutoHotkey. */
export function looksLikeAhk(source: string): boolean {
  return /^\s*#(NoEnv|SingleInstance|Persistent|Requires\s+AutoHotkey|IfWinActive|HotIf)/im.test(source) ||
    /^\s*[~$*^!+#]*\w+::/m.test(source) ||
    /^\s*(Send|SendInput|Sleep|MouseClick|PixelSearch)\s*,/im.test(source)
}
