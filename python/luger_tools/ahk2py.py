"""AutoHotkey (v1 and v2) to Python converter.

Turns hotkeys, labels, functions, loops, conditions and the common commands into a
Python macro that uses the `luger` library. Anything it cannot convert is kept as a
"# LUGER:" comment and listed in the report, so nothing is silently dropped.
"""
import keyword
import re
from dataclasses import dataclass, field

from luger.keys import normalize

# ---------------------------------------------------------------- tokens
TOKEN = re.compile(r"""
 (?P<ws>\s+)
|(?P<num>0[xX][0-9a-fA-F]+|\d+\.\d*(?:[eE][-+]?\d+)?|\.\d+|\d+)
|(?P<str>"(?:[^"`]|""|`.)*"|'(?:[^'`]|`.)*')
|(?P<deref>%[A-Za-z_][\w]*%)
|(?P<id>[A-Za-z_@$][\w@$]*)
|(?P<op>!==|:=|\+=|-=|\*=|/=|\.=|//=|==|!=|<>|<=|>=|&&|\|\||\+\+|--|\*\*|//|<<|>>|~=|[-+*/<>=!~&|^?:.,()\[\]{}%])
""", re.X)

PY_KEYWORDS = set(keyword.kwlist) | {"print", "luger", "ui", "math", "random"}
COMPARE = {"=": "==", "==": "==", "!=": "!=", "!==": "!=", "<>": "!=", "<": "<", ">": ">", "<=": "<=", ">=": ">="}
BUILTIN_VARS = {
    "a_tickcount": "luger.tick()", "a_screenwidth": "luger.screen_size()[0]", "a_screenheight": "luger.screen_size()[1]",
    "a_space": '" "', "a_tab": '"\\t"', "true": "True", "false": "False", "a_now": "luger.tick()",
    "a_ispaused": "False", "a_issuspended": "False", "a_thishotkey": '""',
}
FUNC_MAP = {
    "getkeystate": "luger.is_pressed", "random": "luger.random", "abs": "abs", "round": "round", "floor": "luger.floor",
    "ceil": "luger.ceil", "strlen": "len", "substr": "luger.substr", "instr": "luger.instr", "max": "max", "min": "min",
    "integer": "int", "float": "float", "string": "str", "mod": "luger.mod", "sqrt": "luger.sqrt",
    "winactive": "luger.roblox_active", "winexist": "luger.roblox_active", "pixelgetcolor": "luger.pixel_hex",
    "strupper": "str.upper", "strlower": "str.lower", "trim": "str.strip", "isnumber": "luger.is_number",
    "isinteger": "luger.is_number", "a_tickcount": "luger.tick",
}
DROP_ARGS = {"winactive", "winexist"}            # Roblox is the only window Luger cares about
IGNORED = {"sendmode", "setkeydelay", "setmousedelay", "setdefaultmousespeed", "setbatchlines", "setworkingdir",
           "coordmode", "settitlematchmode", "detecthiddenwindows", "listlines", "setcontroldelay", "setwindelay",
           "setcapslockstate", "setnumlockstate", "setscrolllockstate", "process", "thread", "critical",
           "setformat", "autotrim", "stringcasesense", "fileencoding", "menu", "traysetIcon", "a_traymenu",
           "persistent", "installkeybdhook", "installmousehook", "keyhistory", "#notrayicon"}


@dataclass
class Arg:
    raw: str
    py: str
    literal: str | None = None     # the plain text when the argument is a constant


@dataclass
class Report:
    unsupported: list = field(default_factory=list)
    notes: list = field(default_factory=list)


class ConvertError(Exception):
    pass


def _sanitize(name: str) -> str:
    n = re.sub(r"[^\w]", "_", name)
    if n.lower() in PY_KEYWORDS or keyword.iskeyword(n):
        n += "_"
    if n and n[0].isdigit():
        n = "_" + n
    return n


def _unescape(s: str, v1: bool) -> str:
    body = s[1:-1]
    if v1 and s[0] == '"':
        body = body.replace('""', '"')
    out, i = [], 0
    esc = {"n": "\n", "t": "\t", "r": "\r", "b": "\b", "s": " ", "`": "`", '"': '"', "'": "'", ";": ";", ",": ",",
           "%": "%", "{": "{", "}": "}", ":": ":"}
    while i < len(body):
        if body[i] == "`" and i + 1 < len(body):
            out.append(esc.get(body[i + 1], body[i + 1]))
            i += 2
        else:
            out.append(body[i])
            i += 1
    return "".join(out)


def ahk_hotkey_to_combo(spec: str) -> tuple[str, bool, str | None]:
    """'~^!F1 up' -> ('ctrl+alt+f1', True, note)."""
    note = None
    s = spec.strip()
    release = False
    if s.lower().endswith(" up"):
        release, s = True, s[:-3].strip()
    if " & " in s:
        first, second = [p.strip() for p in s.split(" & ", 1)]
        note = f"Custom combo '{spec}' became '{second}' held with '{first}' not supported; using '{second}'"
        s = second
    mods = []
    while len(s) > 1 and s[0] in "~$*<>^!+#":
        ch, s = s[0], s[1:]
        m = {"^": "ctrl", "!": "alt", "+": "shift", "#": "cmd"}.get(ch)
        if m and m not in mods:
            mods.append(m)
    key = normalize(s)
    ordered = [m for m in ("ctrl", "alt", "shift", "cmd") if m in mods]
    return "+".join(ordered + [key]), release, note


# ---------------------------------------------------------------- converter
class Converter:
    def __init__(self, source: str):
        self.src = source
        self.v1 = not self._is_v2(source)
        self.report = Report()
        self.names: dict[str, str] = {}          # lower -> canonical variable name
        self.funcs: dict[str, str] = {}          # lower -> python function name
        self.labels: set[str] = set()
        self.module_globals: set[str] = {"ErrorLevel"}
        self.assigned: set[str] = set()
        self.declared_globals: set[str] = set()
        self.loop_depth = 0
        self.lines: list[tuple[int, str]] = []
        self.i = 0
        self.hotif = None
        self.gui_vars: list[str] = []
        self.gui_count = 0
        self.tmp = 0
        self._all_assigned: set[str] = set()

    # ------------------------------------------------ helpers
    @staticmethod
    def _is_v2(src: str) -> bool:
        if re.search(r"#Requires\s+AutoHotkey\s+v?2", src, re.I):
            return True
        if re.search(r"#Requires\s+AutoHotkey\s+v?1", src, re.I):
            return False
        v2_hits = len(re.findall(r"^\s*(Send|SendInput|Sleep|Click|MsgBox|ToolTip|SetTimer|MouseMove|KeyWait)\s*\(", src, re.I | re.M))
        v2_hits += len(re.findall(r"^\s*(Send|SendInput|SendText)\s+\"", src, re.I | re.M))
        v2_hits += len(re.findall(r"::\s*\{", src))
        v1_hits = len(re.findall(r"^\s*(Send|SendInput|Sleep|Click|MsgBox|ToolTip|SetTimer|MouseMove|KeyWait|MouseClick|PixelSearch|PixelGetColor|Random|Loop)\s*,", src, re.I | re.M))
        v1_hits += len(re.findall(r"^\s*return\s*$", src, re.I | re.M)) // 2
        v1_hits += len(re.findall(r"%\w+%", src))
        return v2_hits > v1_hits

    def var(self, name: str) -> str:
        low = name.lower()
        if low == "a_index":
            return f"A_Index{self.loop_depth if self.loop_depth > 1 else ''}"
        if low == "errorlevel":
            return "ErrorLevel"
        if low not in self.names:
            self.names[low] = _sanitize(name)
        return self.names[low]

    def assign_target(self, name: str) -> str:
        n = self.var(name)
        self.assigned.add(n)
        return n

    def unsupported(self, lineno: int, text: str, reason: str) -> str:
        self.report.unsupported.append({"line": lineno, "text": text.strip(), "reason": reason})
        return f"# LUGER: not converted ({reason}): {text.strip()}"

    # ------------------------------------------------ preprocessing
    def preprocess(self) -> None:
        out: list[tuple[int, str]] = []
        in_block = False
        continuation = False
        for n, raw in enumerate(self.src.splitlines(), 1):
            line = raw.rstrip()
            stripped = line.strip()
            if in_block:
                if stripped.startswith("*/") or stripped.endswith("*/"):
                    in_block = False
                continue
            if stripped.startswith("/*"):
                in_block = not stripped.endswith("*/")
                continue
            if continuation:
                if stripped.startswith(")"):
                    continuation = False
                    if out:
                        out[-1] = (out[-1][0], out[-1][1] + stripped[1:])
                    continue
                if out:
                    out[-1] = (out[-1][0], out[-1][1] + "`n" + stripped)
                continue
            line = self._strip_comment(line).rstrip()
            if not line.strip():
                continue
            if line.strip() == "(" and out:
                continuation = True
                continue
            # Lines starting with an operator or comma continue the previous line.
            if out and re.match(r"^\s*(,|&&|\|\||\band\b|\bor\b|\.\s|\?|:(?!:))", line, re.I) and not re.match(r"^\s*::", line):
                out[-1] = (out[-1][0], out[-1][1] + " " + line.strip())
                continue
            for piece in self._split_braces(line.strip()):
                out.append((n, piece))
        self.lines = out

    @staticmethod
    def _strip_comment(line: str) -> str:
        if line.lstrip().startswith(";"):
            return ""
        quote = None
        for i, ch in enumerate(line):
            if quote:
                if ch == quote and line[i - 1:i] != "`":
                    quote = None
            elif ch in "\"'" and (ch == '"' or not re.match(r"^\s*\w+\s*,", line)):
                quote = ch
            elif ch == ";" and i > 0 and line[i - 1] in " \t" and line[i - 1:i] != "`":
                return line[:i]
        return line

    @staticmethod
    def _split_braces(line: str) -> list[str]:
        parts = []
        while line.startswith("}") and line != "}":
            parts.append("}")
            line = line[1:].strip()
        if line.endswith("{") and line != "{" and not line.endswith("::{") and re.match(r"^(\w+\s*\(.*\)|else|loop|while|for|if|try|catch|finally)\b", line, re.I) is None and "::" not in line:
            parts.append(line)
            return parts
        parts.append(line)
        return parts

    # ------------------------------------------------ expression translation
    def tokens(self, text: str) -> list[tuple[str, str]]:
        toks, pos = [], 0
        while pos < len(text):
            m = TOKEN.match(text, pos)
            if not m:
                raise ConvertError(f"Cannot read expression near: {text[pos:pos + 20]!r}")
            toks.append((m.lastgroup, m.group()))
            pos = m.end()
        return toks

    def expr(self, text: str) -> str:
        text = text.strip()
        if not text:
            return '""'
        return self._trans([t for t in self.tokens(text)])

    @staticmethod
    def _strip_ws(toks):
        while toks and toks[0][0] == "ws":
            toks = toks[1:]
        while toks and toks[-1][0] == "ws":
            toks = toks[:-1]
        return toks

    @staticmethod
    def _depth_iter(toks):
        depth = 0
        for i, (k, t) in enumerate(toks):
            if k == "op" and t in "([{":
                depth += 1
            elif k == "op" and t in ")]}":
                depth -= 1
            yield i, depth, k, t

    def _split(self, toks, pred):
        parts, cur = [], []
        for i, depth, k, t in self._depth_iter(toks):
            if depth == 0 and pred(k, t) and not (k == "op" and t in "([{"):
                parts.append(cur)
                cur = []
            else:
                cur.append((k, t))
        parts.append(cur)
        return parts

    def _trans(self, toks) -> str:
        toks = self._strip_ws(toks)
        if not toks:
            return '""'
        # ternary
        q = next((i for i, d, k, t in self._depth_iter(toks) if d == 0 and k == "op" and t == "?"), None)
        if q is not None:
            depth_q, c = 0, None
            for i, d, k, t in self._depth_iter(toks[q + 1:]):
                if d == 0 and k == "op" and t == "?":
                    depth_q += 1
                elif d == 0 and k == "op" and t == ":":
                    if depth_q == 0:
                        c = q + 1 + i
                        break
                    depth_q -= 1
            if c is not None:
                return f"({self._trans(toks[q + 1:c])} if {self._trans(toks[:q])} else {self._trans(toks[c + 1:])})"
        for ops, joiner in (({"||", "or"}, " or "), ({"&&", "and"}, " and ")):
            parts = self._split(toks, lambda k, t, ops=ops: (k == "op" and t in ops) or (k == "id" and t.lower() in ops))
            if len(parts) > 1:
                return joiner.join(self._trans(p) for p in parts)
        first = toks[0]
        if (first[0] == "id" and first[1].lower() == "not"):
            return "not " + self._trans(toks[1:])
        # comparison
        for i, d, k, t in self._depth_iter(toks):
            if d == 0 and k == "op" and t in COMPARE:
                left, right = toks[:i], toks[i + 1:]
                if self._strip_ws(left) and self._strip_ws(right):
                    return f"{self._trans(left)} {COMPARE[t]} {self._trans(right)}"
        # concatenation: ' . ' with spaces, or two operands side by side (AHK v1 implicit concat)
        parts, cur, depth = [], [], 0
        prev_operand = False
        for idx, (k, t) in enumerate(toks):
            if k == "op" and t in "([{":
                depth += 1
            if k == "op" and t in ")]}":
                depth -= 1
            if depth == 0 and k == "op" and t == "." and idx > 0 and toks[idx - 1][0] == "ws":
                parts.append(cur)
                cur, prev_operand = [], False
                continue
            if depth == 0 and k == "ws" and prev_operand:
                nxt = next((tk for tk in toks[idx + 1:] if tk[0] != "ws"), None)
                if nxt and (nxt[0] in ("str", "num", "deref") or (nxt[0] == "id" and nxt[1].lower() not in ("and", "or", "not", "in", "is", "contains", "between"))):
                    parts.append(cur)
                    cur, prev_operand = [], False
                    continue
            cur.append((k, t))
            if k != "ws":
                prev_operand = (k in ("str", "num", "id", "deref") or (k == "op" and t in ")]")) and depth == 0
        parts.append(cur)
        parts = [p for p in parts if self._strip_ws(p)]
        if len(parts) > 1:
            return "luger.cat(" + ", ".join(self._trans(p) for p in parts) + ")"
        return self._atoms(toks)

    def _atoms(self, toks) -> str:
        out: list[str] = []
        i = 0
        while i < len(toks):
            k, t = toks[i]
            if k == "ws":
                out.append(" ")
            elif k == "str":
                out.append(repr(_unescape(t, self.v1)))
            elif k == "num":
                out.append(t)
            elif k == "deref":
                out.append(self.var(t[1:-1]))
            elif k == "id":
                low = t.lower()
                nxt = toks[i + 1] if i + 1 < len(toks) else None
                prev = toks[i - 1] if i > 0 else None
                if prev and prev == ("op", "."):
                    out.append(t)                       # member access
                elif nxt and nxt == ("op", "("):
                    close = self._match(toks, i + 1)
                    inner = toks[i + 2:close]
                    args = [self._trans(a) for a in self._split(inner, lambda kk, tt: kk == "op" and tt == ",") if self._strip_ws(a)]
                    if low in ("pixelsearch", "imagesearch"):
                        raise ConvertError("PixelSearch/ImageSearch inside an expression")
                    if low in DROP_ARGS:
                        args = []
                    if low == "getkeystate" and len(args) > 1:
                        args = args[:1]
                    fn = FUNC_MAP.get(low) or self.funcs.get(low) or _sanitize(t)
                    out.append(f"{fn}({', '.join(args)})")
                    i = close + 1
                    continue
                elif low in BUILTIN_VARS:
                    out.append(BUILTIN_VARS[low])
                elif low in ("and", "or", "not", "in", "is"):
                    out.append(f" {low} ")
                elif low in self.funcs and not (nxt and nxt == ("op", "(")):
                    out.append(self.funcs[low])
                else:
                    out.append(self.var(t))
            elif k == "op":
                if t == "!":
                    out.append("not ")
                elif t == "&" and (i + 1 < len(toks) and toks[i + 1][0] == "id") and (i == 0 or toks[i - 1][0] in ("ws", "op")):
                    pass                                # v2 by-reference marker
                elif t in ("++", "--"):
                    raise ConvertError("++/-- inside an expression")
                elif t == ":=":
                    raise ConvertError("assignment inside an expression")
                elif t == "~=":
                    raise ConvertError("regex match operator")
                elif t == "[":
                    close = self._match(toks, i)
                    inner = toks[i + 1:close]
                    if out and out[-1].strip() and out[-1].strip()[-1:] not in "(,=[ ":
                        out.append(f"[({self._trans(inner)}) - 1]")   # AHK arrays start at 1
                    else:
                        items = [self._trans(a) for a in self._split(inner, lambda kk, tt: kk == "op" and tt == ",") if self._strip_ws(a)]
                        out.append("[" + ", ".join(items) + "]")
                    i = close + 1
                    continue
                elif t == "(":
                    close = self._match(toks, i)
                    out.append("(" + self._trans(toks[i + 1:close]) + ")")
                    i = close + 1
                    continue
                elif t == "%":
                    pass
                else:
                    out.append(t)
            i += 1
        text = "".join(out)
        return re.sub(r"\s+", " ", text).strip()

    @staticmethod
    def _match(toks, open_idx) -> int:
        depth = 0
        for j in range(open_idx, len(toks)):
            k, t = toks[j]
            if k == "op" and t in "([{":
                depth += 1
            elif k == "op" and t in ")]}":
                depth -= 1
                if depth == 0:
                    return j
        raise ConvertError("Unbalanced brackets")

    # v1 text arguments: "Hello %name%!" or "% expression"
    def text(self, raw: str) -> Arg:
        raw = raw.strip()
        if raw.startswith("% ") or raw == "%":
            py = self.expr(raw[1:])
            return Arg(raw, py, None)
        pieces = re.split(r"(%[A-Za-z_]\w*%)", raw)
        if len(pieces) == 1:
            lit = _unescape('"' + raw.replace('"', '`"') + '"', False)
            return Arg(raw, repr(lit), lit)
        parts = []
        for p in pieces:
            if not p:
                continue
            if p.startswith("%") and p.endswith("%"):
                parts.append(self.var(p[1:-1]))
            else:
                parts.append(repr(_unescape('"' + p.replace('"', '`"') + '"', False)))
        return Arg(raw, "luger.cat(" + ", ".join(parts) + ")", None)

    def num(self, raw: str) -> Arg:
        raw = raw.strip()
        if not raw:
            return Arg(raw, "None", None)
        single = re.fullmatch(r"%\s*([A-Za-z_]\w*)\s*%", raw)
        if single:
            return Arg(raw, self.var(single.group(1)), None)
        if self.v1 and ("%" in raw and not raw.startswith("% ")):
            a = self.text(raw)
            return Arg(raw, a.py if a.literal is None else a.literal, a.literal)
        if raw.startswith("% "):
            raw = raw[2:]
        py = self.expr(raw)
        return Arg(raw, py, raw if re.fullmatch(r"-?(0x[0-9a-fA-F]+|\d+(\.\d+)?)", raw) else None)

    def word(self, raw: str) -> Arg:
        raw = raw.strip()
        if not self.v1 and len(raw) >= 2 and raw[0] in "\"'" and raw[-1] == raw[0]:
            lit = _unescape(raw, False)
            return Arg(raw, repr(lit), lit)
        if not self.v1 and raw and not raw[0] in "\"'":
            return Arg(raw, self.expr(raw), None)
        return Arg(raw, repr(raw), raw)

    # ------------------------------------------------ statements
    def split_args(self, text: str, limit: int | None = None) -> list[str]:
        args, cur, depth, quote, i = [], [], 0, None, 0
        while i < len(text):
            ch = text[i]
            if ch == "`" and i + 1 < len(text):
                cur.append(text[i:i + 2])
                i += 2
                continue
            if quote:
                if ch == quote:
                    quote = None
            elif ch == '"' and (not self.v1 or text.lstrip().startswith("%") or depth):
                quote = ch
            elif ch in "([{":
                depth += 1
            elif ch in ")]}":
                depth -= 1
            elif ch == "," and depth == 0 and (limit is None or len(args) < limit - 1):
                args.append("".join(cur))
                cur = []
                i += 1
                continue
            cur.append(ch)
            i += 1
        args.append("".join(cur))
        return [a.strip() for a in args]

    def parse_command(self, line: str) -> tuple[str, list[str], bool] | None:
        """Return (command, raw args, function_style) for command-shaped lines."""
        m = re.match(r"^([A-Za-z]\w*)\((.*)\)$", line)
        if m and m.group(1).lower() in COMMANDS and self._closing_at_end(line, len(m.group(1))):
            return m.group(1).lower(), self.split_args(m.group(2)), True
        m = re.match(r"^([A-Za-z]\w*)(?:\s*,\s*|\s+|$)(.*)$", line)
        if not m or m.group(1).lower() not in COMMANDS:
            return None
        rest = m.group(2)
        if re.match(r"^\s*(:=|\+=|-=|\*=|/=|\.=|=|\+\+|--)", rest) and not line.lower().startswith("if"):
            return None
        spec = COMMANDS[m.group(1).lower()]
        return m.group(1).lower(), self.split_args(rest, len(spec)) if rest.strip() else [], not self.v1

    @staticmethod
    def _closing_at_end(line: str, open_at: int) -> bool:
        depth, quote = 0, None
        for i in range(open_at, len(line)):
            ch = line[i]
            if quote:
                if ch == quote:
                    quote = None
                continue
            if ch == '"':
                quote = ch
            elif ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
                if depth == 0:
                    return i == len(line) - 1
        return False

    def make_args(self, cmd: str, raw: list[str], fstyle: bool) -> list[Arg]:
        spec = COMMANDS[cmd]
        out = []
        for i, r in enumerate(raw):
            kind = spec[i] if i < len(spec) else "num"
            if fstyle or not self.v1:
                if kind == "var":
                    name = r.strip().lstrip("&").strip()
                    out.append(Arg(r, name, name))
                elif kind == "word":
                    out.append(self.word(r))
                else:
                    py = self.expr(r) if r.strip() else "None"
                    lit = _unescape(r.strip(), False) if re.fullmatch(r"\"(?:[^\"`]|`.)*\"|'(?:[^'`]|`.)*'", r.strip()) else (r.strip() if re.fullmatch(r"-?(0x[0-9a-fA-F]+|\d+(\.\d+)?)", r.strip()) else None)
                    out.append(Arg(r, py, lit))
            else:
                if kind == "text":
                    out.append(self.text(r))
                elif kind == "var":
                    out.append(Arg(r, r.strip(), r.strip()))
                elif kind == "word":
                    out.append(self.text(r) if "%" in r else Arg(r, repr(r.strip()), r.strip()))
                else:
                    out.append(self.num(r))
        return out

    def statement(self, lineno: int, line: str) -> list[str]:
        """Translate one simple (non-block) statement."""
        low = line.lower()
        try:
            cmd = self.parse_command(line)
            if cmd:
                name, raw, fstyle = cmd
                return HANDLERS[name](self, self.make_args(name, raw, fstyle), lineno, line)
            if low.startswith("#"):
                return self.directive(lineno, line)
            if re.match(r"^\w+\s*:=\s*Gui\s*\(", line) or re.match(r"^(\w+\s*:=\s*)?\w+\.Add\s*\(", line):
                return self.gui_v2(lineno, line)
            # assignments
            m = re.match(r"^([A-Za-z_@$][\w@$.\[\]\"']*)\s*(:=|\+=|-=|\*=|/=|//=|\.=)\s*(.*)$", line)
            if m:
                target, op, value = m.groups()
                if "[" in target or "." in target:
                    tgt = self._atoms(self.tokens(target))
                else:
                    tgt = self.assign_target(target)
                if op == ".=":
                    return [f"{tgt} = luger.cat({tgt}, {self.expr(value)})"]
                if re.match(r"^\w+\s*:=", value.strip()):
                    chain = [tgt]
                    while (m2 := re.match(r"^([A-Za-z_]\w*)\s*:=\s*(.*)$", value.strip())):
                        chain.append(self.assign_target(m2.group(1)))
                        value = m2.group(2)
                    return [" = ".join(chain) + f" = {self.expr(value)}"]
                return [f"{tgt} {'=' if op == ':=' else op} {self.expr(value)}"]
            m = re.match(r"^([A-Za-z_]\w*)\s*=\s*(.*)$", line)
            if m and self.v1:
                tgt = self.assign_target(m.group(1))
                a = self.text(m.group(2))
                if a.literal is not None and re.fullmatch(r"-?(0x[0-9a-fA-F]+|\d+(\.\d+)?)", a.literal.strip()):
                    return [f"{tgt} = {a.literal.strip()}"]
                return [f"{tgt} = {a.py}"]
            m = re.match(r"^(\+\+|--)?([A-Za-z_]\w*)(\+\+|--)?$", line)
            if m and (m.group(1) or m.group(3)):
                tgt = self.assign_target(m.group(2))
                return [f"{tgt} {'+' if '+' in (m.group(1) or m.group(3)) else '-'}= 1"]
            m = re.match(r"^(global|local|static)\b\s*(.*)$", line, re.I)
            if m:
                return self.scope_decl(lineno, m.group(1).lower(), m.group(2))
            # GUI v2 object calls
            if re.search(r"\bGui\s*\(", line) or re.search(r"\.(Add|Show|OnEvent|Submit|Hide|Destroy)\s*\(", line):
                return self.gui_v2(lineno, line)
            # bare function call or expression
            if re.match(r"^[A-Za-z_][\w.]*\s*\(.*\)$", line):
                return [self.expr(line)]
            if re.match(r"^[A-Za-z_]\w*$", line) and line.lower() in self.funcs:
                return [f"{self.funcs[line.lower()]}()"]
            if re.match(r"^[A-Za-z_]\w*$", line) and line.lower() in {lab.lower() for lab in self.labels}:
                return [f"{self.funcs.get(line.lower(), _sanitize(line))}()"]
            if re.match(r"^[A-Za-z_]\w*(\s*,|\s+\S)", line):
                first = re.match(r"^[A-Za-z_]\w*", line).group().lower()
                if first in self.funcs:   # v2 command-style call of a user function
                    rest = line[len(first):].strip().lstrip(",")
                    args = [self.expr(a) for a in self.split_args(rest)] if rest else []
                    return [f"{self.funcs[first]}({', '.join(args)})"]
                return [self.unsupported(lineno, line, "unknown command")]
            return [self.expr(line)]
        except (ConvertError, ValueError) as exc:
            return [self.unsupported(lineno, line, str(exc))]

    def scope_decl(self, lineno: int, kind: str, rest: str) -> list[str]:
        names = []
        out = []
        for part in self.split_args(rest):
            if not part:
                continue
            m = re.match(r"^([A-Za-z_]\w*)\s*(?::=\s*(.*))?$", part)
            if not m:
                out.append(self.unsupported(lineno, part, f"{kind} declaration"))
                continue
            name = self.var(m.group(1))
            names.append(name)
            if kind == "global":
                self.declared_globals.add(name)
                self.module_globals.add(name)
            if m.group(2) is not None:
                if kind == "static":
                    out.append(self.unsupported(lineno, part, "static variables keep their value only for this run"))
                    self.declared_globals.add(name)
                    self.module_globals.add(name)
                else:
                    out.append(f"{name} = {self.expr(m.group(2))}")
        if kind == "global" and not rest.strip():
            self.declared_globals.add("*")
        return out

    def directive(self, lineno: int, line: str) -> list[str]:
        low = line.lower()
        if low.startswith(("#ifwinactive", "#hotif", "#ifwinexist")):
            arg = line.split(None, 1)[1] if len(line.split(None, 1)) > 1 else ""
            self.hotif = None if not arg.strip() else ("roblox" if "roblox" in arg.lower() or "winactive" in low or "#ifwin" in low else None)
            if arg.strip() and "roblox" not in arg.lower():
                self.report.notes.append(f"Line {lineno}: window condition '{arg.strip()}' treated as 'Roblox is focused'.")
                self.hotif = "roblox"
            return []
        if low.startswith(("#ifwinnotactive", "#if ")):
            self.report.notes.append(f"Line {lineno}: '{line}' is ignored; hotkeys below it are always active.")
            self.hotif = None
            return []
        if low.startswith(("#include",)):
            return [self.unsupported(lineno, line, "#Include files must be added separately")]
        return []        # other directives (#NoEnv, #SingleInstance, #Requires, #MaxThreadsPerHotkey...) do nothing in Python

    # ------------------------------------------------ v2 GUI
    def gui_v2(self, lineno: int, line: str) -> list[str]:
        m = re.match(r"^(\w+)\s*:=\s*Gui\s*\((.*)\)$", line)
        if m:
            args = self.split_args(m.group(2))
            title = self.expr(args[1]) if len(args) > 1 and args[1] else "'Macro'"
            return [f"ui.window({title})"]
        m = re.match(r"^(?:(\w+)\s*:=\s*)?\w+\.Add\s*\(\s*(\"\w+\"|'\w+')\s*(?:,\s*(.*?))?\)(?:\.OnEvent\s*\(\s*\"(\w+)\"\s*,\s*(\w+)\s*\))?$", line)
        if m:
            var_name, kind, rest, event, handler = m.groups()
            kind = kind.strip("\"'").lower()
            args = self.split_args(rest) if rest else []
            opts = _unescape(args[0], False) if args and args[0] and args[0][0] in "\"'" else ""
            label = self.expr(args[1]) if len(args) > 1 and args[1] else "''"
            vmatch = re.search(r"\bv(\w+)", opts)
            cid = vmatch.group(1) if vmatch else (var_name or f"control{self.gui_count + 1}")
            self.gui_count += 1
            cb = f", {self.funcs.get(handler.lower(), _sanitize(handler))}" if handler else ""
            target = f"{self.assign_target(var_name)} = " if var_name else ""
            if vmatch:
                self.gui_vars.append(cid)
            return [target + self._gui_control(kind, cid, label, opts, cb, lineno, line)]
        if re.search(r"\.Show\s*\(|\.Hide\s*\(|\.Destroy\s*\(", line):
            return []
        if re.search(r"\.Submit\s*\(", line):
            return [f"{self.assign_target(v)} = ui.value({v!r})" for v in self.gui_vars]
        return [self.unsupported(lineno, line, "this window command")]

    def _gui_control(self, kind, cid, label, opts, cb, lineno, line) -> str:
        if kind == "button":
            return f"ui.button({cid!r}, {label}{cb.replace(', ', ', on_click=') if cb else ''})"
        if kind == "text":
            return f"ui.label({cid!r}, {label})"
        if kind == "checkbox":
            return f"ui.toggle({cid!r}, {label}, default={'True' if 'checked' in opts.lower() else 'False'}{cb.replace(', ', ', on_change=') if cb else ''})"
        if kind == "edit":
            return f"ui.text_input({cid!r}, '', default={label})"
        if kind == "slider":
            r = re.search(r"range(-?\d+)-(-?\d+)", opts, re.I)
            lo, hi = (r.group(1), r.group(2)) if r else ("0", "100")
            return f"ui.slider({cid!r}, {cid!r}, {lo}, {hi}, default={label if label not in ('', chr(39) * 2) else lo})"
        if kind == "hotkey":
            return f"ui.keybind({cid!r}, {cid!r}, default={label})"
        if kind in ("dropdownlist", "ddl", "combobox"):
            return f"ui.select({cid!r}, {cid!r}, {label}.split('|'))"
        return self.unsupported(lineno, line, f"window control type '{kind}'")

    # ------------------------------------------------ blocks
    def peek(self):
        return self.lines[self.i] if self.i < len(self.lines) else (None, None)

    def is_definition(self, idx: int) -> str | None:
        if idx >= len(self.lines):
            return None
        _, line = self.lines[idx]
        if re.match(r"^::.*::", line):
            return "hotstring"
        if HOTKEY_RE.match(line) and not line.lower().startswith(("if", "while")):
            return "hotkey"
        if re.match(r"^[A-Za-z_][\w]*:$", line) and not line.lower() in ("default:",):
            return "label"
        m = re.match(r"^([A-Za-z_]\w*)\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*(\{)?$", line)
        if m and m.group(1).lower() not in ("if", "while", "loop", "for") and (m.group(3) or (idx + 1 < len(self.lines) and self.lines[idx + 1][1] == "{")):
            return "function"
        return None

    def block(self, indent: int, until_return: bool = False) -> list[str]:
        """Parse statements until '}' (consumed), a top-level return (hotkey/label bodies) or a new definition."""
        out: list[str] = []
        while self.i < len(self.lines):
            lineno, line = self.lines[self.i]
            if line == "}":
                self.i += 1
                return out
            if until_return and self.is_definition(self.i):
                return out
            if until_return and re.match(r"^return\b", line, re.I):
                self.i += 1
                rest = line[6:].strip()
                if rest:
                    out.append(self.pad(indent) + f"return {self.expr(rest)}")
                return out
            out.extend(self.one(indent))
        return out

    def pad(self, indent: int) -> str:
        return "    " * indent

    def body_of(self, indent: int, header_has_brace: bool) -> list[str]:
        if header_has_brace:
            body = self.block(indent)
        elif self.i < len(self.lines) and self.lines[self.i][1] == "{":
            self.i += 1
            body = self.block(indent)
        else:
            body = self.one(indent) if self.i < len(self.lines) else []
        return _ensure_body(body, indent)

    def one(self, indent: int) -> list[str]:
        """Parse exactly one statement (simple or compound) at self.i."""
        lineno, line = self.lines[self.i]
        self.i += 1
        p = self.pad(indent)
        low = line.lower()
        brace = line.endswith("{") and line != "{"
        head = line[:-1].strip() if brace else line

        if line == "{":
            return self.block(indent) or []

        m = re.match(r"^if\b\s*(.*)$", head, re.I)
        if m and not re.match(r"^if\w", low):
            out = self.if_chain(indent, lineno, m.group(1), brace)
            return out
        m = re.match(r"^(ifwinactive|ifwinnotactive|ifwinexist|ifwinnotexist)\b", low)
        if m:
            neg = "not" in m.group(1)
            out = [p + f"if {'not ' if neg else ''}luger.roblox_active():"]
            out += self.body_of(indent + 1, brace)
            return out + self.else_part(indent)
        m = re.match(r"^(ifequal|ifnotequal|ifgreater|ifless|ifgreaterorequal|iflessorequal)\s*,\s*(\w+)\s*,?\s*(.*)$", head, re.I)
        if m:
            op = {"ifequal": "==", "ifnotequal": "!=", "ifgreater": ">", "ifless": "<", "ifgreaterorequal": ">=", "iflessorequal": "<="}[m.group(1).lower()]
            rhs = self.text(m.group(3))
            out = [p + f"if {self.var(m.group(2))} {op} {rhs.literal if rhs.literal and re.fullmatch(r'-?\d+(\.\d+)?', rhs.literal) else rhs.py}:"]
            out += self.body_of(indent + 1, brace)
            return out + self.else_part(indent)
        m = re.match(r"^loop\b\s*,?\s*(.*)$", head, re.I)
        if m and not re.match(r"^loop\w", low):
            return self.loop(indent, lineno, m.group(1).strip(), brace, line)
        m = re.match(r"^while\b\s*(.*)$", head, re.I)
        if m and not re.match(r"^while\w", low):
            self.loop_depth += 1
            cond_pre, cond = self.condition(m.group(1), lineno)
            if cond_pre:
                out = [p + "while True:"] + [self.pad(indent + 1) + c for c in cond_pre] + [self.pad(indent + 1) + f"if not ({cond}):", self.pad(indent + 2) + "break"]
            else:
                out = [p + f"while {cond}:"]
            out.append(self.pad(indent + 1) + "luger.wait(0)")
            out += self.body_of(indent + 1, brace)
            out += self.until(indent + 1)
            self.loop_depth -= 1
            return out
        m = re.match(r"^for\s+(.*?)\s+in\s+(.*)$", head, re.I)
        if m:
            names = [self.assign_target(n.strip()) for n in m.group(1).split(",") if n.strip()]
            obj = self.expr(m.group(2))
            if len(names) == 1:
                hdr = f"for {names[0]} in ({obj}.keys() if isinstance({obj}, dict) else range(1, len({obj}) + 1)):"
            else:
                hdr = f"for {', '.join(names)} in ({obj}.items() if isinstance({obj}, dict) else enumerate({obj}, 1)):"
            return [p + hdr] + self.body_of(indent + 1, brace)
        if re.match(r"^else\b", low):
            return [p + self.unsupported(lineno, line, "else without if")]
        if re.match(r"^try\b", low):
            out = [p + "try:"] + self.body_of(indent + 1, brace)
            nl = self.peek()[1]
            if nl and re.match(r"^catch\b", nl, re.I):
                self.i += 1
                out += [p + "except Exception:"] + self.body_of(indent + 1, nl.endswith("{"))
            else:
                out += [p + "except Exception:", self.pad(indent + 1) + "pass"]
            if self.peek()[1] and re.match(r"^finally\b", self.peek()[1], re.I):
                nl = self.peek()[1]
                self.i += 1
                out += [p + "finally:"] + self.body_of(indent + 1, nl.endswith("{"))
            return out
        m = re.match(r"^return\b\s*(.*)$", line, re.I)
        if m:
            return [p + (f"return {self.expr(m.group(1))}" if m.group(1).strip() else "return")]
        if low in ("break", "continue"):
            return [p + low]
        if re.match(r"^(exit)\b", low):
            return [p + "return"]
        stmts = self.statement(lineno, line)
        return [p + s for s in stmts]

    def condition(self, text: str, lineno: int) -> tuple[list[str], str]:
        """Translate a condition. PixelSearch/ImageSearch calls with &out vars become pre-statements."""
        pre: list[str] = []
        m = re.search(r"\b(PixelSearch|ImageSearch)\s*\(", text, re.I)
        if m:
            start = m.start()
            open_idx = m.end() - 1
            depth, end = 0, None
            for j in range(open_idx, len(text)):
                if text[j] == "(":
                    depth += 1
                elif text[j] == ")":
                    depth -= 1
                    if depth == 0:
                        end = j
                        break
            if end is None:
                raise ConvertError("Unbalanced brackets")
            args = self.split_args(text[open_idx + 1:end])
            self.tmp += 1
            found = f"_found{self.tmp}"
            pre += self.search_call(m.group(1).lower(), [Arg(a, self.expr(a) if not a.strip().startswith("&") else a.strip()[1:].strip()) for a in args], found, v2=True)
            text = text[:start] + f"__FOUND{self.tmp}__" + text[end + 1:]
            cond = self.expr(text).replace(f"__FOUND{self.tmp}__", f"({found} is not None)")
            return pre, cond
        return pre, self.expr(text)

    def legacy_if(self, text: str) -> str | None:
        """v1 'if var = value' compares against literal text."""
        if not self.v1 or text.lstrip().startswith("("):
            return None
        m = re.match(r"^([A-Za-z_]\w*)\s*(=|==|!=|<>|<=|>=|<|>)\s*(.*)$", text)
        if m:
            rhs = self.text(m.group(3))
            val = rhs.literal.strip() if rhs.literal is not None and re.fullmatch(r"-?(0x[0-9a-fA-F]+|\d+(\.\d+)?)", rhs.literal.strip()) else rhs.py
            return f"{self.var(m.group(1))} {COMPARE[m.group(2)]} {val}"
        m = re.match(r"^([A-Za-z_]\w*)\s+(not\s+)?between\s+(.+?)\s+and\s+(.+)$", text, re.I)
        if m:
            neg = "not " if m.group(2) else ""
            return f"{neg}({self.text(m.group(3)).py if not m.group(3).strip().isdigit() else m.group(3)} <= {self.var(m.group(1))} <= {self.text(m.group(4)).py if not m.group(4).strip().isdigit() else m.group(4)})"
        m = re.match(r"^([A-Za-z_]\w*)\s+(not\s+)?(in|contains)\s+(.+)$", text, re.I)
        if m:
            items = [i.strip() for i in m.group(4).split(",")]
            var = f"str({self.var(m.group(1))})"
            if m.group(3).lower() == "in":
                return f"{var} {'not in' if m.group(2) else 'in'} {items!r}"
            check = f"any(s in {var} for s in {items!r})"
            return f"not {check}" if m.group(2) else check
        if re.fullmatch(r"[A-Za-z_]\w*", text.strip()):
            return self.var(text.strip())
        return None

    def if_chain(self, indent: int, lineno: int, cond_text: str, brace: bool) -> list[str]:
        p = self.pad(indent)
        cond_text = cond_text.strip()
        legacy = self.legacy_if(cond_text)
        pre, cond = ([], legacy) if legacy is not None else self.condition(cond_text, lineno)
        out = [p + c for c in pre] + [p + f"if {cond}:"]
        out += self.body_of(indent + 1, brace)
        return out + self.else_part(indent)

    def else_part(self, indent: int) -> list[str]:
        p = self.pad(indent)
        lineno, nl = self.peek()
        if not nl or not re.match(r"^else\b", nl, re.I):
            return []
        self.i += 1
        rest = nl[4:].strip()
        brace = rest.endswith("{")
        if brace:
            rest = rest[:-1].strip()
        m = re.match(r"^if\b\s*(.*)$", rest, re.I)
        if m:
            legacy = self.legacy_if(m.group(1).strip())
            pre, cond = ([], legacy) if legacy is not None else self.condition(m.group(1), lineno)
            if pre:
                return [p + "else:"] + [self.pad(indent + 1) + c for c in pre] + [self.pad(indent + 1) + f"if {cond}:"] + self.body_of(indent + 2, brace) + self.else_part(indent + 1)
            return [p + f"elif {cond}:"] + self.body_of(indent + 1, brace) + self.else_part(indent)
        if rest:
            # 'else Send x' on one line
            return [p + "else:"] + [self.pad(indent + 1) + s for s in self.statement(lineno, rest)]
        return [p + "else:"] + self.body_of(indent + 1, brace)

    def until(self, indent: int) -> list[str]:
        lineno, nl = self.peek()
        if nl and re.match(r"^until\b", nl, re.I):
            self.i += 1
            pre, cond = self.condition(nl[5:].strip(), lineno)
            return [self.pad(indent) + c for c in pre] + [self.pad(indent) + f"if {cond}:", self.pad(indent + 1) + "break"]
        return []

    def loop(self, indent: int, lineno: int, arg: str, brace: bool, line: str) -> list[str]:
        p = self.pad(indent)
        low = arg.lower()
        if re.match(r"^(parse|read|files|reg)\b", low) or re.match(r"^(%\s*)?[\w%]+\s*,\s*", arg) and not re.match(r"^%?\s*\w+\s*$", arg):
            if re.match(r"^parse\b", low):
                parts = self.split_args(arg)
                src = self.text("%" + parts[1].strip() + "%") if len(parts) > 1 and self.v1 else Arg(parts[1], self.expr(parts[1]))
                delim = repr(_unescape('"' + parts[2] + '"', False)) if len(parts) > 2 and parts[2] else None
                self.loop_depth += 1
                idx = self.var("A_Index")
                field_var = "A_LoopField"
                self.assigned.update({idx, field_var})
                split = f"str({src.py}).split({delim})" if delim and delim != "''" else f"list(str({src.py}))"
                out = [p + f"for {idx}, {field_var} in enumerate({split}, 1):", self.pad(indent + 1) + "luger.wait(0)"]
                out += self.body_of(indent + 1, brace) + self.until(indent + 1)
                self.loop_depth -= 1
                return out
            self.body_of(indent + 1, brace)
            return [p + self.unsupported(lineno, line, "file/registry loops")]
        self.loop_depth += 1
        idx = self.var("A_Index")
        self.assigned.add(idx)
        count = arg.strip()
        if count.startswith("%"):
            count = count.strip("% ")
        if not count:
            out = [p + f"{idx} = 0", p + "while True:", self.pad(indent + 1) + f"{idx} += 1", self.pad(indent + 1) + "luger.wait(0)"]
        else:
            n = self.num(count).py if self.v1 else self.expr(count)
            out = [p + f"for {idx} in range(1, int({n}) + 1):", self.pad(indent + 1) + "luger.wait(0)"]
        out += self.body_of(indent + 1, brace)
        out += self.until(indent + 1)
        self.loop_depth -= 1
        return out

    # ------------------------------------------------ search helpers
    def search_call(self, kind: str, a: list[Arg], found: str, v2: bool) -> list[str]:
        if len(a) < 7:
            raise ConvertError(f"{kind} needs at least 7 arguments")
        ox, oy = self.assign_target(a[0].py.strip("&").strip() if v2 else a[0].raw.strip()), self.assign_target(a[1].py.strip("&").strip() if v2 else a[1].raw.strip())
        region = f"({a[2].py}, {a[3].py}, {a[4].py}, {a[5].py})"
        if kind == "pixelsearch":
            variation = a[7].py if len(a) > 7 and a[7].py not in ("None", '""') else "0"
            mode = (a[8].literal or "") if len(a) > 8 else ""
            order = "'rgb'" if (v2 or "rgb" in mode.lower()) else "'bgr'"
            call = f"luger.find_color({a[6].py}, {region}, {variation}, order={order})"
        else:
            img = a[6]
            lit = img.literal or ""
            var = re.search(r"\*(\d+)", lit)
            path = re.sub(r"\*\w+\s*", "", lit).strip() if lit else None
            call = f"luger.find_image({repr(path) if path is not None else img.py}, {region}, {var.group(1) if var else 0})"
        self.module_globals.add("ErrorLevel")
        self.assigned.add("ErrorLevel")
        return [f"{found} = {call}", f"{ox}, {oy} = {found} if {found} else ('', '')", f"ErrorLevel = 0 if {found} else 1"]

    # ------------------------------------------------ top level
    def convert(self) -> dict:
        self.preprocess()
        # First pass: learn function and label names so calls resolve.
        for idx, (_, line) in enumerate(self.lines):
            kind = self.is_definition(idx)
            if kind == "function":
                name = re.match(r"^([A-Za-z_]\w*)", line).group(1)
                self.funcs[name.lower()] = _sanitize(name)
            elif kind == "label":
                name = line[:-1]
                self.labels.add(name)
                self.funcs[name.lower()] = _sanitize(name)

        defs: list[str] = []
        hotkeys: list[str] = []
        auto: list[str] = []
        auto_assigned: set[str] = set()
        hotkey_names: dict[str, int] = {}
        pending: list[tuple[str, bool, int, str]] = []    # stacked hotkeys sharing one body
        self.i = 0
        in_auto = True

        while self.i < len(self.lines):
            lineno, line = self.lines[self.i]
            kind = self.is_definition(self.i)
            if kind == "hotstring":
                self.i += 1
                auto.append(self.unsupported(lineno, line, "hotstrings (text replacement)"))
                continue
            if kind is None:
                if line.startswith("#"):
                    self.i += 1
                    res = self.directive(lineno, line)
                    (auto if in_auto else defs).extend(res)
                    continue
                if not in_auto and re.match(r"^return\b", line, re.I):
                    self.i += 1
                    continue
                self.assigned = auto_assigned
                if re.match(r"^return\b", line, re.I):
                    self.i += 1
                    in_auto = False
                    continue
                auto.extend(self.one(1))
                continue
            in_auto = False
            if kind == "function":
                defs.extend(self.function_def())
                continue
            if kind == "label":
                name = line[:-1]
                self.i += 1
                self.assigned = set()
                body = self.block(1, until_return=True)
                defs.extend(self.wrap_def(self.funcs[name.lower()], "", body, lineno, f"label {name}"))
                continue
            # hotkey
            m = HOTKEY_RE.match(line)
            spec, rest = m.group(1), m.group(2).strip()
            self.i += 1
            try:
                combo, release, note = ahk_hotkey_to_combo(spec)
            except ValueError as exc:
                hotkeys.append(self.unsupported(lineno, line, str(exc)))
                if not rest:
                    self.block(1, until_return=True)
                continue
            if note:
                self.report.notes.append(f"Line {lineno}: {note}")
            if not rest and self.i < len(self.lines) and self.is_definition(self.i) == "hotkey" and not self.lines[self.i][1].endswith("{"):
                pending.append((combo, release, lineno, spec))
                continue
            self.assigned = set()
            remap = None
            if rest and rest != "{" and not rest.endswith("{"):
                try:
                    target = normalize(rest) if re.fullmatch(r"[\w]+", rest) and rest.lower() not in COMMANDS and rest.lower() not in self.funcs else None
                except ValueError:
                    target = None
                if target:
                    remap = target
                    body = []
                else:
                    stmts = self.statement(lineno, rest)
                    body = ["    " + s for s in stmts]
            elif rest.endswith("{"):
                body = self.block(1)
            elif self.i < len(self.lines) and self.lines[self.i][1] == "{" and not self.v1:
                self.i += 1
                body = self.block(1)
            else:
                body = self.block(1, until_return=True)
            group = pending + [(combo, release, lineno, spec)]
            pending = []
            uses_suspend = any("suspend_toggle" in b for b in body)
            for combo_i, release_i, ln, spec_i in group:
                base = "hk_" + re.sub(r"\W", "_", combo_i) + ("_up" if release_i else "")
                hotkey_names[base] = hotkey_names.get(base, 0) + 1
                fname = base if hotkey_names[base] == 1 else f"{base}_{hotkey_names[base]}"
                cond = self.hotif
                if remap:
                    hotkeys += [f"@luger.hotkey({combo_i!r})", f"def {fname}():", f"    luger.key_down({remap!r})", "",
                                f"@luger.hotkey({combo_i!r}, on_release=True)", f"def {fname}_release():", f"    luger.key_up({remap!r})", ""]
                    continue
                guard = ["    if not luger.roblox_active():", "        return"] if cond == "roblox" else []
                opts = ", on_release=True" if release_i else ""
                opts += ", always=True" if uses_suspend else ""
                hotkeys.append(f"@luger.hotkey({combo_i!r}{opts})")
                hotkeys.extend(self.wrap_def(fname, "", guard + body, ln, f"hotkey {spec_i}"))

        for combo, release, ln, spec in pending:
            hotkeys.append(self.unsupported(ln, f"{spec}::", "hotkey with no body"))

        globals_needed = sorted((self.module_globals | auto_assigned | self._all_assigned) - set(self.funcs.values()) - {"*"})
        out = [
            "# Converted from AutoHotkey by Luger.",
            "# Lines marked 'LUGER:' could not be converted automatically; see the conversion report.",
            "import luger",
            "from luger import ui",
            "",
        ]
        if globals_needed:
            out.append("# AutoHotkey variables start empty; here they start at 0.")
            out += [f"{g} = 0" for g in globals_needed]
            out.append("")
        out += defs + hotkeys
        if auto:
            gl = sorted((auto_assigned | {g for g in globals_needed}) - set(self.funcs.values()))
            out += ["def _auto_execute():"]
            if gl:
                out.append("    global " + ", ".join(gl))
            out += auto + [""]
            out += ["_auto_execute()"]
        out += ["luger.run()", ""]
        return {"source": "\n".join(out), "version": 1 if self.v1 else 2,
                "unsupported": self.report.unsupported, "notes": self.report.notes}

    def wrap_def(self, name: str, params: str, body: list[str], lineno: int, what: str, local_scope: bool = False) -> list[str]:
        assigned = set(self.assigned)
        if not local_scope:
            self._all_assigned = self._all_assigned | assigned
            gl = sorted(assigned - set(self.funcs.values()))
        else:
            gl = sorted(self.declared_globals - {"*"}) if "*" not in self.declared_globals else sorted(assigned - set(self.funcs.values()) - set(p.strip("*= ").split("=")[0].strip() for p in params.split(",")))
            if "*" in self.declared_globals:
                self._all_assigned = self._all_assigned | set(gl)
        lines = [f"def {name}({params}):"]
        if gl:
            lines.append("    global " + ", ".join(gl))
        lines += _ensure_body(body, 1)
        return lines + [""]

    def function_def(self) -> list[str]:
        lineno, line = self.lines[self.i]
        m = re.match(r"^([A-Za-z_]\w*)\((.*)\)\s*(\{)?$", line)
        self.i += 1
        if not m.group(3):
            self.i += 1          # the '{' on its own line
        params = []
        for p in self.split_args(m.group(2)):
            p = p.strip()
            if not p:
                continue
            byref = p.lower().startswith(("byref ", "&"))
            p = re.sub(r"^(byref\s+|&)", "", p, flags=re.I).strip()
            if byref:
                self.report.notes.append(f"Line {lineno}: by-reference parameter '{p}' is passed by value in Python.")
            if p.endswith("*"):
                params.append("*" + (_sanitize(p[:-1]) if p[:-1] else "_args"))
                continue
            pm = re.match(r"^(\w+)\s*(?::=|=)\s*(.*)$", p)
            if pm:
                params.append(f"{self.var(pm.group(1))}={self.expr(pm.group(2))}")
            else:
                params.append(self.var(p))
        self.assigned = set()
        self.declared_globals = set()
        body = self.block(1)
        result = self.wrap_def(self.funcs[m.group(1).lower()], ", ".join(params), body, lineno, "function", local_scope=True)
        self.declared_globals = set()
        return result


def _ensure_body(body: list[str], indent: int) -> list[str]:
    """Python needs at least one real statement in every block."""
    if any(b.strip() and not b.strip().startswith("#") for b in body):
        return body
    return body + ["    " * indent + "pass"]


HOTKEY_RE = re.compile(r"^((?:[~$*<>^!+#]*)(?:[^\s:,]+(?:\s+&\s+[^\s:]+)?|[^\s])(?:\s+up)?)::(.*)$", re.I)


# ---------------------------------------------------------------- command handlers
def _send(raw: bool):
    def h(c: Converter, a, n, line):
        if not a:
            return []
        return [f"luger.send({a[0].py}{', raw=True' if raw else ''})"]
    return h


def _sleep(c, a, n, line):
    return [f"luger.wait_ms({a[0].py if a else 0})"]


def _click(c, a, n, line):
    if c.v1 and len(a) == 1 and a[0].literal is None and "%" in a[0].raw:
        parts = [p for p in re.split(r"[\s,]+", a[0].raw.strip()) if p]
        return [f"luger.click_ahk({', '.join(c.num(p).py if '%' in p else repr(p) for p in parts)})"]
    if len(a) == 1 and a[0].literal is not None:
        parts = re.split(r"[\s,]+", a[0].literal.strip())
        return [f"luger.click_ahk({', '.join(repr(p) for p in parts if p)})"]
    return [f"luger.click_ahk({', '.join(x.py for x in a)})"]


def _mouseclick(c, a, n, line):
    btn = (a[0].literal or "left").lower() if a else "left"
    button = {"left": "mouse1", "l": "mouse1", "right": "mouse2", "r": "mouse2", "middle": "mouse3", "m": "mouse3",
              "x1": "mouse4", "x2": "mouse5"}.get(btn, "mouse1")
    x = a[1].py if len(a) > 1 and a[1].raw.strip() else "None"
    y = a[2].py if len(a) > 2 and a[2].raw.strip() else "None"
    count = a[3].py if len(a) > 3 and a[3].raw.strip() else "1"
    du = (a[5].literal or "").lower() if len(a) > 5 else ""
    action = "'down'" if du in ("d", "down") else "'up'" if du in ("u", "up") else "'tap'"
    rel = len(a) > 6 and (a[6].literal or "").lower() == "r"
    if rel and x != "None":
        return [f"luger.move({x}, {y}, relative=True)", f"luger.click({button!r}, count={count}, action={action})"]
    return [f"luger.click({button!r}, {x}, {y}, count={count}, action={action})"]


def _mousemove(c, a, n, line):
    rel = len(a) > 3 and (a[3].literal or "").lower() == "r"
    return [f"luger.move({a[0].py}, {a[1].py}{', relative=True' if rel else ''})"]


def _mousegetpos(c, a, n, line):
    names = [c.assign_target(x.raw.strip().lstrip("&").strip()) if x.raw.strip() else "_" for x in a[:2]]
    while len(names) < 2:
        names.append("_")
    return [f"{names[0]}, {names[1]} = luger.position()"]


def _pixelgetcolor(c, a, n, line):
    mode = (a[3].literal or "") if len(a) > 3 else ""
    out = c.assign_target(a[0].raw.strip())
    return [f"{out} = luger.pixel_hex({a[1].py}, {a[2].py}, order={'rgb' if 'rgb' in mode.lower() else 'bgr'!r})"]


def _search(kind):
    def h(c: Converter, a, n, line):
        c.tmp += 1
        return c.search_call(kind, a, f"_found{c.tmp}", v2=not c.v1)
    return h


def _keywait(c, a, n, line):
    key = a[0].py
    opts = (a[1].literal or "") if len(a) > 1 else ""
    down = "d" in opts.lower()
    t = re.search(r"t(\d+(\.\d+)?)", opts, re.I)
    return [f"ErrorLevel = 0 if luger.wait_key({key}, down={down}{', timeout=' + t.group(1) if t else ''}) else 1"]


def _getkeystate(c, a, n, line):
    out = c.assign_target(a[0].raw.strip())
    return [f"{out} = luger.is_pressed({a[1].py})"]


def _random(c, a, n, line):
    out = c.assign_target(a[0].raw.strip())
    lo = a[1].py if len(a) > 1 and a[1].raw.strip() else "0"
    hi = a[2].py if len(a) > 2 and a[2].raw.strip() else "2147483647"
    return [f"{out} = luger.random({lo}, {hi})"]


def _msgbox(c, a, n, line):
    if not a:
        return ["luger.notify('Press OK to continue.')"]
    if c.v1 and len(a) >= 3 and (a[0].literal or "").strip().isdigit():
        return [f"luger.notify({a[2].py}, title={a[1].py})"]
    if not c.v1 and len(a) >= 2:
        return [f"luger.notify({a[0].py}, title={a[1].py})"]
    return [f"luger.notify({a[0].py})"]


def _tooltip(c, a, n, line):
    return [f"ui.status({a[0].py if a and a[0].raw.strip() else repr('')})"]


def _traytip(c, a, n, line):
    if len(a) >= 2:
        return [f"luger.notify({a[1].py}, title={a[0].py})"]
    return [f"luger.notify({a[0].py if a else repr('')})"]


def _settimer(c: Converter, a, n, line):
    if not a:
        return [c.unsupported(n, line, "SetTimer without a target")]
    target = a[0].raw.strip().strip('"\'')
    fn = c.funcs.get(target.lower())
    if not fn:
        if c.v1:
            return [c.unsupported(n, line, f"timer target '{target}' not found")]
        fn = a[0].py
    period = a[1].literal if len(a) > 1 and a[1].literal is not None else (a[1].py if len(a) > 1 else "250")
    p = str(period).strip().lower()
    if p in ("off", "delete", "'off'", "'delete'", "0"):
        return [f"luger.cancel({fn})"]
    if p in ("on", "'on'", ""):
        p = "250"
    return [f"luger.every({period if not isinstance(period, str) or not re.fullmatch(r'-?\d+', p) else p}, {fn})"]


def _gosub(c: Converter, a, n, line):
    target = a[0].raw.strip()
    fn = c.funcs.get(target.lower())
    return [f"{fn}()"] if fn else [c.unsupported(n, line, f"label '{target}' not found")]


def _goto(c, a, n, line):
    return [c.unsupported(n, line, "Goto has no Python equivalent; restructure with a loop")]


def _exitapp(c, a, n, line):
    return ["luger.exit()"]


def _pause(c, a, n, line):
    return ["luger.pause_toggle()"]


def _suspend(c, a, n, line):
    return ["luger.suspend_toggle()"]


def _reload(c, a, n, line):
    c.report.notes.append(f"Line {n}: Reload stops the macro; start it again from Luger.")
    return ["luger.exit()"]


def _winactivate(c, a, n, line):
    return ["luger.focus_roblox()"]


def _winwait(c, a, n, line):
    return ["while not luger.roblox_active():", "    luger.wait(0.1)"]


def _beep(c, a, n, line):
    return ["luger.log('beep')"]


def _ignored(c, a, n, line):
    return []


def _gui_v1(c: Converter, a, n, line):
    if not a:
        return []
    sub = (a[0].literal or a[0].raw).strip().lower()
    sub = sub.split(":")[-1]
    if sub == "add" and len(a) >= 2:
        kind = (a[1].literal or "").lower()
        opts = a[2].literal or "" if len(a) > 2 else ""
        label = a[3].py if len(a) > 3 else "''"
        v = re.search(r"\bv(\w+)", opts)
        g = re.search(r"\bg(\w+)", opts)
        c.gui_count += 1
        cid = v.group(1) if v else f"control{c.gui_count}"
        if v:
            c.gui_vars.append(cid)
        cb = ""
        if g and g.group(1).lower() in c.funcs:
            cb = f", {c.funcs[g.group(1).lower()]}"
        return [c._gui_control(kind, cid, label, opts, cb, n, line)]
    if sub == "show":
        title = a[2].py if len(a) > 2 and a[2].raw.strip() else "'Macro'"
        return [f"ui.window({title})"]
    if sub == "submit":
        return [f"{c.assign_target(v)} = ui.value({v!r})" for v in c.gui_vars]
    if sub in ("destroy", "hide", "cancel", "font", "color", "margin", "+alwaysontop", "-caption", "+lastfound", "+owner", "new"):
        return []
    if sub.startswith(("+", "-")):
        return []
    return [c.unsupported(n, line, f"Gui {sub}")]


def _sendlevel(c, a, n, line):
    return []


def _soundplay(c, a, n, line):
    return [c.unsupported(n, line, "sounds are not supported in macros")]


def _run(c, a, n, line):
    return [c.unsupported(n, line, "starting other programs is blocked for safety")]


# name -> parameter kinds (text | num | var | word)
COMMANDS: dict[str, list[str]] = {
    "send": ["text"], "sendinput": ["text"], "sendevent": ["text"], "sendplay": ["text"], "sendraw": ["text"],
    "sendtext": ["text"], "sleep": ["num"], "click": ["text"], "mouseclick": ["word", "num", "num", "num", "num", "word", "word"],
    "mousemove": ["num", "num", "num", "word"], "mousegetpos": ["var", "var", "var", "var"],
    "pixelgetcolor": ["var", "num", "num", "word"], "pixelsearch": ["var", "var", "num", "num", "num", "num", "num", "num", "word"],
    "imagesearch": ["var", "var", "num", "num", "num", "num", "text"], "keywait": ["text", "word"],
    "getkeystate": ["var", "text", "word"], "random": ["var", "num", "num"], "msgbox": ["text", "text", "text", "num"],
    "tooltip": ["text", "num", "num", "num"], "traytip": ["text", "text", "num", "num"], "settimer": ["word", "word", "num"],
    "gosub": ["word"], "goto": ["word"], "exitapp": ["num"], "pause": ["word"], "suspend": ["word"], "reload": [],
    "winactivate": ["text"], "winwaitactive": ["text", "text", "num"], "winwait": ["text", "text", "num"],
    "soundbeep": ["num", "num"], "gui": ["word", "word", "text", "text"], "sendlevel": ["num"], "soundplay": ["text"],
    "run": ["text"], "runwait": ["text"],
    **{k: ["text"] * 4 for k in IGNORED if not k.startswith("#")},
}
HANDLERS = {
    "send": _send(False), "sendinput": _send(False), "sendevent": _send(False), "sendplay": _send(False),
    "sendraw": _send(True), "sendtext": _send(True), "sleep": _sleep, "click": _click, "mouseclick": _mouseclick,
    "mousemove": _mousemove, "mousegetpos": _mousegetpos, "pixelgetcolor": _pixelgetcolor,
    "pixelsearch": _search("pixelsearch"), "imagesearch": _search("imagesearch"), "keywait": _keywait,
    "getkeystate": _getkeystate, "random": _random, "msgbox": _msgbox, "tooltip": _tooltip, "traytip": _traytip,
    "settimer": _settimer, "gosub": _gosub, "goto": _goto, "exitapp": _exitapp, "pause": _pause, "suspend": _suspend,
    "reload": _reload, "winactivate": _winactivate, "winwaitactive": _winwait, "winwait": _winwait, "soundbeep": _beep,
    "gui": _gui_v1, "sendlevel": _sendlevel, "soundplay": _soundplay, "run": _run, "runwait": _run,
    **{k: _ignored for k in IGNORED if not k.startswith("#")},
}


def convert(source: str) -> dict:
    result = Converter(source).convert()
    try:
        compile(result["source"], "<converted>", "exec")
        result["valid"] = True
    except SyntaxError as exc:
        result["valid"] = False
        result["error"] = f"Line {exc.lineno}: {exc.msg}"
    return result
