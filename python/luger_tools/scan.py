"""Static malware scan for Python macros.

Works on the syntax tree, unwraps encoded payloads (base64/hex/zlib/rot13 chains) and
rescans what they decode to. clean() removes every flagged statement.
"""
import ast
import base64
import binascii
import codecs
import math
import re
import zlib
from collections import Counter

NETWORK = {"socket", "ssl", "http", "urllib", "urllib2", "urllib3", "requests", "httpx", "aiohttp", "ftplib",
           "smtplib", "poplib", "imaplib", "telnetlib", "xmlrpc", "websocket", "websockets", "paramiko", "discord",
           "dhooks", "pycurl", "asyncio", "selectors", "socketserver", "webbrowser"}
PROCESS = {"subprocess", "multiprocessing", "pty", "pexpect", "sh", "shlex"}
NATIVE = {"ctypes", "cffi", "_ctypes", "winreg", "_winreg", "win32api", "win32con", "win32crypt", "win32process",
          "pywintypes", "mmap", "msvcrt"}
DANGEROUS_MODULES = {"pickle", "marshal", "shelve", "importlib", "imp", "runpy", "code", "codeop", "zipimport",
                     "pkgutil", "builtins", "__builtin__", "browser_cookie3", "pycryptodome", "Crypto", "Cryptodome",
                     "keyring", "pyperclip", "pynput.keyboard._win32", "PIL.ImageGrab", "shutil", "tempfile",
                     "sqlite3", "glob", "pathlib", "os.path"}
ALLOWED_MODULES = {"luger", "time", "math", "random", "re", "json", "datetime", "itertools", "functools",
                   "collections", "dataclasses", "enum", "typing", "statistics", "string", "threading", "numpy",
                   "PIL", "PIL.Image", "copy", "operator", "decimal", "fractions", "heapq", "bisect", "textwrap"}
DANGEROUS_CALLS = {"eval", "exec", "compile", "__import__", "execfile", "globals", "vars", "breakpoint",
                   "getattr", "setattr", "delattr", "input"}
OS_CALLS = {"system", "popen", "spawnl", "spawnle", "spawnlp", "spawnv", "spawnve", "spawnvp", "execl", "execle",
            "execlp", "execv", "execve", "execvp", "fork", "kill", "remove", "unlink", "rmdir", "removedirs",
            "rename", "replace", "startfile", "walk", "listdir", "scandir", "getenv", "putenv", "chmod", "chown",
            "makedirs", "mkdir", "environ"}
SENSITIVE = [
    (r"roblosecurity", "Roblox login cookie"),
    (r"robloxcookies|rbx-cookie|robloxcookie", "Roblox login cookie"),
    (r"discord(app)?\.com/api/webhooks|discord\.com/api/v\d+/webhooks", "Discord webhook (data exfiltration)"),
    (r"api\.telegram\.org/bot", "Telegram bot (data exfiltration)"),
    (r"local state|login data|web data|cookies(\.sqlite)?\b|\\network\\cookies", "Browser password or cookie store"),
    (r"leveldb|discord\\local storage|discordcanary|discordptb", "Discord token store"),
    (r"\bappdata\b|%appdata%|~/library/application support|\.mozilla|\.config/google-chrome", "User data folders"),
    (r"wallet\.dat|exodus|metamask|electrum", "Crypto wallet"),
    (r"pastebin\.com/raw|transfer\.sh|anonfiles|gofile\.io|ngrok", "Remote payload host"),
    (r"schtasks|reg add|currentversion\\run|launchagents|crontab|systemctl", "Persistence (auto-start)"),
    (r"powershell|cmd\.exe|/bin/sh|/bin/bash|-encodedcommand", "Shell execution"),
]
DECODERS = {"b64decode", "b32decode", "b16decode", "b85decode", "a85decode", "urlsafe_b64decode", "decodebytes",
            "unhexlify", "fromhex", "decompress", "loads", "decode", "rot13"}


class Finding(dict):
    def __init__(self, line: int, rule: str, severity: str, message: str):
        super().__init__(line=line, rule=rule, severity=severity, message=message)


def _entropy(s: str) -> float:
    if not s:
        return 0.0
    counts = Counter(s)
    return -sum(c / len(s) * math.log2(c / len(s)) for c in counts.values())


def _try_decode(text: str, depth: int = 0) -> list[str]:
    """Return plausible decoded payloads hidden in a string literal."""
    if depth > 4 or len(text) < 24:
        return []
    out = []
    raw = text.strip().encode()
    attempts = []
    try:
        attempts.append(base64.b64decode(raw + b"=" * (-len(raw) % 4), validate=False))
    except (binascii.Error, ValueError):
        pass
    if re.fullmatch(rb"[0-9a-fA-F\s]+", raw):
        try:
            attempts.append(binascii.unhexlify(re.sub(rb"\s", b"", raw)))
        except (binascii.Error, ValueError):
            pass
    attempts.append(codecs.encode(text, "rot13").encode())
    for data in attempts:
        for candidate in (data, _maybe_zlib(data)):
            if not candidate:
                continue
            try:
                decoded = candidate.decode("utf-8")
            except UnicodeDecodeError:
                continue
            printable = sum(ch.isprintable() or ch in "\n\t\r" for ch in decoded) / max(1, len(decoded))
            if printable > 0.95 and decoded != text:
                out.append(decoded)
                out.extend(_try_decode(decoded, depth + 1))
    return out


def _maybe_zlib(data: bytes) -> bytes | None:
    try:
        return zlib.decompress(data)
    except zlib.error:
        return None


def _looks_like_python(text: str) -> bool:
    try:
        tree = ast.parse(text)
    except (SyntaxError, ValueError):
        return False
    return any(isinstance(n, (ast.Import, ast.ImportFrom, ast.Call, ast.FunctionDef)) for n in ast.walk(tree))


def _root(name: str | None) -> str:
    return (name or "").split(".")[0]


def _call_name(func: ast.AST) -> tuple[str, str]:
    """('os', 'system') for os.system, ('', 'eval') for eval."""
    if isinstance(func, ast.Name):
        return "", func.id
    if isinstance(func, ast.Attribute):
        base = func.value
        while isinstance(base, ast.Attribute):
            base = base.value
        return (base.id if isinstance(base, ast.Name) else ""), func.attr
    return "", ""


def scan(source: str, _depth: int = 0) -> dict:
    findings: list[Finding] = []
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        return {"verdict": "invalid", "findings": [Finding(exc.lineno or 0, "syntax", "high", f"Not valid Python: {exc.msg}")]}

    aliases: dict[str, str] = {}
    blocked_names: dict[str, tuple[str, str]] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                r = _root(a.name)
                for group, rule in ((NETWORK, "network"), (PROCESS, "process"), (NATIVE, "native")):
                    if r in group:
                        blocked_names[a.asname or r] = (rule, a.name)
        elif isinstance(node, ast.ImportFrom):
            r = _root(node.module)
            for group, rule in ((NETWORK, "network"), (PROCESS, "process"), (NATIVE, "native")):
                if r in group:
                    for a in node.names:
                        blocked_names[a.asname or a.name] = (rule, f"{node.module}.{a.name}")
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            mods = [a.name for a in node.names] if isinstance(node, ast.Import) else [node.module or ""]
            for a in node.names:
                aliases[a.asname or a.name.split(".")[0]] = (node.module + "." + a.name) if isinstance(node, ast.ImportFrom) and node.module else a.name
            for m in mods:
                r = _root(m)
                full = m if isinstance(node, ast.Import) else f"{m}"
                if r in NETWORK:
                    findings.append(Finding(node.lineno, "network", "high", f"Uses the network ({full})"))
                elif r in PROCESS:
                    findings.append(Finding(node.lineno, "process", "high", f"Starts other programs ({full})"))
                elif r in NATIVE:
                    findings.append(Finding(node.lineno, "native", "high", f"Calls native system code ({full})"))
                elif r in DANGEROUS_MODULES or full in DANGEROUS_MODULES:
                    findings.append(Finding(node.lineno, "module", "medium", f"Uses a module macros should not need ({full})"))
                elif r == "os" or r == "sys":
                    findings.append(Finding(node.lineno, "system", "low", f"Imports {r}"))
                elif r not in ALLOWED_MODULES and r != "__future__":
                    findings.append(Finding(node.lineno, "unknown_module", "medium", f"Imports an unknown module ({full})"))

        elif isinstance(node, ast.Call):
            base, name = _call_name(node.func)
            hit = blocked_names.get(base or name)
            if hit:
                findings.append(Finding(node.lineno, hit[0], "high", f"Calls {hit[1]}"))
            real_base = _root(aliases.get(base, base))
            if not base and aliases.get(name, "").startswith("os."):
                real_base, base = "os", "os"
            if not base and name in DANGEROUS_CALLS:
                sev = "low" if name in ("getattr", "setattr", "input", "vars", "globals") else "high"
                findings.append(Finding(node.lineno, "dynamic_code", sev, f"Calls {name}()"))
            elif real_base == "os" and name in OS_CALLS:
                findings.append(Finding(node.lineno, "os_call", "high" if name in {"system", "popen", "startfile", "fork"} or name.startswith(("exec", "spawn")) else "medium", f"Calls os.{name}()"))
            elif not base and name == "open":
                mode = node.args[1] if len(node.args) > 1 else next((k.value for k in node.keywords if k.arg == "mode"), None)
                if isinstance(mode, ast.Constant) and any(c in str(mode.value) for c in "wax+"):
                    findings.append(Finding(node.lineno, "file_write", "medium", "Writes files"))
            elif name in DECODERS and real_base in {"base64", "binascii", "zlib", "codecs", "marshal", "bytes", "lzma", "bz2"}:
                findings.append(Finding(node.lineno, "decode", "low", f"Decodes data ({real_base}.{name})"))
            if name in ("exec", "eval") and node.args and isinstance(node.args[0], ast.Call):
                findings.append(Finding(node.lineno, "obfuscated_exec", "high", "Runs decoded or generated code"))

        elif isinstance(node, ast.Attribute):
            if node.attr in {"__globals__", "__builtins__", "__subclasses__", "__code__", "__bases__", "__mro__", "f_globals", "f_back"}:
                findings.append(Finding(node.lineno, "introspection", "high", f"Reaches into interpreter internals ({node.attr})"))
        elif isinstance(node, ast.Name) and node.id == "__builtins__":
            findings.append(Finding(node.lineno, "introspection", "high", "Uses __builtins__"))

        elif isinstance(node, ast.Constant) and isinstance(node.value, (str, bytes)):
            text = node.value.decode("latin-1") if isinstance(node.value, bytes) else node.value
            low = text.lower()
            for pattern, label in SENSITIVE:
                if re.search(pattern, low):
                    findings.append(Finding(getattr(node, "lineno", 0), "sensitive", "high", f"References {label}"))
                    break
            if len(text) >= 200 and _entropy(text) > 4.6:
                findings.append(Finding(getattr(node, "lineno", 0), "entropy", "medium", "Contains a large encoded blob"))
            if _depth < 3:
                for decoded in _try_decode(text):
                    if _looks_like_python(decoded):
                        inner = scan(decoded, _depth + 1)
                        findings.append(Finding(getattr(node, "lineno", 0), "hidden_code", "high", "Hides Python code inside a string"))
                        for f in inner["findings"]:
                            if f["severity"] == "high":
                                findings.append(Finding(getattr(node, "lineno", 0), f["rule"], "high", "Hidden: " + f["message"]))
                    elif any(re.search(p, decoded.lower()) for p, _ in SENSITIVE):
                        findings.append(Finding(getattr(node, "lineno", 0), "hidden_string", "high", "Hides a sensitive string in encoded form"))

    for i, line in enumerate(source.splitlines(), 1):
        if len(line) > 800:
            findings.append(Finding(i, "long_line", "medium", "Has an extremely long line (common in obfuscated code)"))

    unique = {(f["line"], f["rule"], f["message"]): f for f in findings}
    findings = sorted(unique.values(), key=lambda f: (f["line"], f["rule"]))
    if any(f["severity"] == "high" for f in findings):
        verdict = "malicious"
    elif any(f["severity"] == "medium" for f in findings):
        verdict = "suspicious"
    else:
        verdict = "clean"
    return {"verdict": verdict, "findings": findings}


class _Cleaner(ast.NodeTransformer):
    def __init__(self, bad_lines: set[int]):
        self.bad = bad_lines

    def generic_visit(self, node):
        super().generic_visit(node)
        for field in ("body", "orelse", "finalbody", "handlers"):
            stmts = getattr(node, field, None)
            if isinstance(stmts, list) and field != "handlers":
                kept = [s for s in stmts if not self._is_bad(s)]
                if not kept and stmts:
                    kept = [ast.Pass()]
                setattr(node, field, kept)
        return node

    def _is_bad(self, stmt) -> bool:
        if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.If, ast.For, ast.While, ast.With, ast.Try)):
            return getattr(stmt, "lineno", -1) in self.bad
        start, end = getattr(stmt, "lineno", -1), getattr(stmt, "end_lineno", -1)
        return any(start <= b <= end for b in self.bad)


def clean(source: str) -> dict:
    """Remove every statement with a medium or high finding. Repeats until stable."""
    current = source
    for _ in range(5):
        result = scan(current)
        bad = {f["line"] for f in result["findings"] if f["severity"] in ("high", "medium")}
        if not bad or result["verdict"] == "invalid":
            break
        tree = _Cleaner(bad).visit(ast.parse(current))
        ast.fix_missing_locations(tree)
        current = "# Cleaned by Luger: risky lines were removed. This macro may no longer work.\n" + ast.unparse(tree) + "\n"
    final = scan(current)
    return {"source": current, "verdict": final["verdict"], "findings": final["findings"]}
