"""Find the key binds a macro uses and rewrite them in place.

Binds are found on the syntax tree: luger.hotkey/press/key_down/... string arguments,
keys inside luger.send(...) strings, and ui.keybind defaults. Rewrites replace only the
exact characters of each key, so comments and formatting survive.
"""
import ast

from luger.keys import normalize, normalize_combo
from luger.sendparse import parse_send

KEY_ARG_FUNCS = {"press", "key_down", "key_up", "hold", "is_pressed", "wait_key", "mouse_down", "mouse_up", "click"}
HOTKEY_FUNCS = {"hotkey"}


def _func_name(call: ast.Call) -> str:
    f = call.func
    if isinstance(f, ast.Attribute):
        return f.attr
    if isinstance(f, ast.Name):
        return f.id
    return ""


def _line_offsets(source: str) -> list[int]:
    """Byte offset of the start of each line (ast columns are UTF-8 byte offsets)."""
    offsets, total = [0], 0
    for line in source.encode("utf-8").splitlines(keepends=True):
        total += len(line)
        offsets.append(total)
    return offsets


def _literal_span(node: ast.Constant, src_bytes: bytes, offsets: list[int]) -> tuple[int, int, str] | None:
    """Byte span of the literal's contents (inside the quotes) and the quote prefix."""
    if node.lineno != node.end_lineno:
        return None
    start = offsets[node.lineno - 1] + node.col_offset
    end = offsets[node.end_lineno - 1] + node.end_col_offset
    text = src_bytes[start:end].decode("utf-8")
    i = 0
    while i < len(text) and text[i] in "rRbBuUfF":
        i += 1
    prefix = text[:i]
    if "f" in prefix.lower() or "b" in prefix.lower():
        return None
    q = text[i:i + 3] if text[i:i + 3] in ('"""', "'''") else text[i]
    inner = text[i + len(q):len(text) - len(q)]
    if inner != node.value:   # escapes present: offsets would not line up, so skip
        return None
    return start + i + len(q), end - len(q), prefix


def detect(source: str) -> list[dict]:
    tree = ast.parse(source)
    src = source.encode("utf-8")
    offsets = _line_offsets(source)
    binds: list[dict] = []
    funcs = {}
    for fn in ast.walk(tree):
        if isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for child in ast.walk(fn):
                funcs.setdefault(id(child), fn.name)

    def add(node, key, kind, inner_start=None, inner_end=None):
        span = _literal_span(node, src, offsets)
        if not span:
            return
        s, e, _ = span
        if inner_start is not None:
            # inner offsets are character offsets inside the literal; convert to bytes
            prefix = node.value[:inner_start].encode("utf-8")
            body = node.value[inner_start:inner_end].encode("utf-8")
            s, e = s + len(prefix), s + len(prefix) + len(body)
        binds.append({"id": f"{s}:{e}", "key": key, "kind": kind, "line": node.lineno,
                      "context": funcs.get(id(node), "")})

    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        name = _func_name(node)
        first = node.args[0] if node.args else None
        is_str = isinstance(first, ast.Constant) and isinstance(first.value, str)
        if name in HOTKEY_FUNCS and is_str:
            try:
                add(first, normalize_combo(first.value), "hotkey")
            except ValueError:
                pass
        elif name in KEY_ARG_FUNCS and is_str:
            try:
                key = normalize_combo(first.value)
            except ValueError:
                continue
            add(first, key, "send")
        elif name == "send" and is_str:
            raw = any(k.arg == "raw" and isinstance(k.value, ast.Constant) and k.value.value for k in node.keywords)
            if raw:
                continue
            try:
                events = parse_send(first.value)
            except ValueError:
                continue
            for ev in events:
                if ev.start >= 0 and ev.action in ("tap", "down", "up"):
                    add(first, ev.key, "send", ev.start, ev.end)
        elif name == "keybind":
            default = node.args[2] if len(node.args) > 2 else next((k.value for k in node.keywords if k.arg == "default"), None)
            if isinstance(default, ast.Constant) and isinstance(default.value, str):
                try:
                    add(default, normalize_combo(default.value), "hotkey")
                except ValueError:
                    pass
    binds.sort(key=lambda b: int(b["id"].split(":")[0]))
    return binds


def _format_for_send(key: str, original: str) -> str:
    """Write a key in the style the surrounding send string expects."""
    if len(original) == 1 and len(key) == 1:
        return key
    return key


def rebind(source: str, changes: dict) -> str:
    """changes maps a bind id (from detect) or an old key ('key:e') to the new key."""
    found = detect(source)
    by_key: dict[str, list[dict]] = {}
    for b in found:
        by_key.setdefault(b["key"], []).append(b)
    edits: dict[str, str] = {}
    for target, new in changes.items():
        new_norm = normalize_combo(new)
        targets = by_key.get(target[4:], []) if target.startswith("key:") else [b for b in found if b["id"] == target]
        for b in targets:
            edits[b["id"]] = new_norm
    src = source.encode("utf-8")
    for bid in sorted(edits, key=lambda i: -int(i.split(":")[0])):
        s, e = (int(x) for x in bid.split(":"))
        old = src[s:e].decode("utf-8")
        new = edits[bid]
        # Inside send strings, single characters stay bare; named keys keep their braces.
        if len(old) == 1 and len(new) > 1 and _inside_send_text(src, s):
            new = "{" + new + "}"
        src = src[:s] + new.encode("utf-8") + src[e:]
    result = src.decode("utf-8")
    ast.parse(result)  # never hand back broken code
    return result


def _inside_send_text(src: bytes, pos: int) -> bool:
    """True when pos is a bare character in a send string (not already inside {...})."""
    line_start = src.rfind(b"\n", 0, pos) + 1
    before = src[line_start:pos]
    return before.count(b"{") == before.count(b"}") and b"send(" in before


def control_matches(binds: list[dict], controls: dict) -> list[dict]:
    """Label each bind with the game control it belongs to, if any."""
    reverse = {}
    for name, key in controls.items():
        try:
            reverse.setdefault(normalize(key), []).append(name)
        except ValueError:
            continue
    for b in binds:
        b["controls"] = reverse.get(b["key"], []) if b["kind"] == "send" else []
    return binds
