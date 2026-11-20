"""Parser for AutoHotkey-style send strings, e.g. "^a{Enter}{Space 3}{e down}".

Each event keeps the character span of the key name inside the original string so
bind detection can rewrite just that key.
"""
from dataclasses import dataclass

from .keys import normalize

MOD_CHARS = {"^": "ctrl", "!": "alt", "+": "shift", "#": "cmd"}


@dataclass
class SendEvent:
    action: str            # "tap" | "down" | "up" | "text" | "click"
    key: str               # normalised key, or literal text for "text"
    count: int = 1
    mods: tuple = ()
    start: int = -1        # span of the key name in the source string (-1 when not rebindable)
    end: int = -1
    args: tuple = ()


def parse_send(text: str, raw: bool = False) -> list[SendEvent]:
    if raw:
        return [SendEvent("text", text)]
    out: list[SendEvent] = []
    mods: list[str] = []
    i = 0
    while i < len(text):
        ch = text[i]
        if ch in MOD_CHARS and i + 1 < len(text):
            mods.append(MOD_CHARS[ch])
            i += 1
            continue
        if ch == "{":
            close = text.find("}", i + 2 if text[i + 1:i + 2] in "{}" else i + 1)
            if close == -1:
                raise ValueError(f"Unclosed {{ in send string: {text!r}")
            inner = text[i + 1:close]
            name, _, rest = inner.partition(" ")
            rest = rest.strip().lower()
            name_start = i + 1
            if name.lower() == "click":
                out.append(SendEvent("click", "mouse1", args=tuple(inner.split()[1:])))
            elif name.lower() == "raw" or name.lower() == "text":
                out.append(SendEvent("text", rest))
            else:
                key = normalize(name)
                if rest in ("down", "downr", "downtemp"):
                    out.append(SendEvent("down", key, mods=tuple(mods), start=name_start, end=name_start + len(name)))
                elif rest == "up":
                    out.append(SendEvent("up", key, mods=tuple(mods), start=name_start, end=name_start + len(name)))
                else:
                    count = int(rest) if rest.isdigit() else 1
                    out.append(SendEvent("tap", key, count, tuple(mods), name_start, name_start + len(name)))
            mods = []
            i = close + 1
            continue
        if ch == "\n":
            out.append(SendEvent("tap", "enter", mods=tuple(mods)))
        elif ch == "\t":
            out.append(SendEvent("tap", "tab", mods=tuple(mods)))
        elif mods or not ch.isprintable() or ch == " ":
            out.append(SendEvent("tap", "space" if ch == " " else ch.lower(), mods=tuple(mods), start=i, end=i + 1))
        else:
            # Plain printable characters are rebindable single keys too.
            out.append(SendEvent("tap", ch.lower() if ch.isalpha() else ch, start=i, end=i + 1,
                                 mods=("shift",) if ch.isalpha() and ch.isupper() else ()))
        mods = []
        i += 1
    return out
