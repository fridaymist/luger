"""luger — the macro library every Luger macro uses.

Cross-platform keyboard, mouse, pixel and hotkey helpers. Input goes through the OS
like a real person's would; Luger never touches the Roblox client itself.
"""
import math as _math
import random as _random
import subprocess as _subprocess
import sys as _sys
import threading
import time as _time

from . import protocol, ui  # noqa: F401  (ui is part of the public API)
from .keys import MOUSE, normalize, normalize_combo
from .sendparse import parse_send

__all__ = [
    "press", "key_down", "key_up", "hold", "type_text", "send", "click", "mouse_down", "mouse_up",
    "move", "position", "scroll", "wait", "wait_ms", "tick", "random", "pixel", "pixel_hex",
    "find_color", "find_image", "screen_size", "is_pressed", "wait_key", "notify", "log", "exit",
    "pause_toggle", "suspend_toggle", "focus_roblox", "roblox_active", "hotkey", "every", "cancel",
    "start", "run", "stopping", "cat", "substr", "instr", "floor", "ceil", "sqrt", "mod", "is_number",
    "click_ahk", "ui", "MacroStopped",
]

_stop = threading.Event()
_resume = threading.Event()
_resume.set()
_suspended = False
_real_run = _subprocess.run          # kept before the sandbox disables subprocess


class MacroStopped(BaseException):
    """Raised inside waits when the macro is stopped. Not an Exception, so bare
    'except Exception' blocks in macros do not swallow it."""


# ---------------------------------------------------------------- input backend
_kb = _ms = None


def _backend():
    global _kb, _ms
    if _kb is None:
        from pynput import keyboard, mouse
        _kb, _ms = keyboard.Controller(), mouse.Controller()
    return _kb, _ms


def _pkey(name: str):
    from pynput.keyboard import Key, KeyCode
    if name.startswith("numpad") and name[6:].isdigit():
        return KeyCode.from_char(name[6:])
    if len(name) == 1:
        return KeyCode.from_char(name)
    try:
        return getattr(Key, name)
    except AttributeError as exc:
        raise ValueError(f"This system cannot send {name!r}") from exc


def _pbutton(name: str):
    from pynput.mouse import Button
    name = MOUSE.get(normalize(name), name)
    return {"left": Button.left, "right": Button.right, "middle": Button.middle}.get(name) or getattr(Button, name)


def _check() -> None:
    if _stop.is_set():
        raise MacroStopped()
    _resume.wait()
    if _stop.is_set():
        raise MacroStopped()


def key_down(key: str) -> None:
    _check()
    k = normalize(key)
    if k in MOUSE:
        return mouse_down(k)
    _backend()[0].press(_pkey(k))


def key_up(key: str) -> None:
    k = normalize(key)
    if k in MOUSE:
        return mouse_up(k)
    _backend()[0].release(_pkey(k))


def press(key: str, hold: float = 0.0) -> None:
    """Tap a key or combo, e.g. press("e"), press("ctrl+shift+s")."""
    parts = normalize_combo(key).split("+")
    for p in parts:
        key_down(p)
    if hold:
        wait(hold)
    for p in reversed(parts):
        key_up(p)


def hold(key: str, seconds: float) -> None:
    press(key, hold=seconds)


def type_text(text: str, delay: float = 0.0) -> None:
    for ch in text:
        _check()
        _backend()[0].type(ch)
        if delay:
            wait(delay)


def send(text: str, raw: bool = False, delay: float = 0.0) -> None:
    """AutoHotkey-style send: send("^a{Enter}{Space 3}{e down}")."""
    for ev in parse_send(text, raw):
        _check()
        if ev.action == "text":
            type_text(ev.key)
            continue
        if ev.action == "click":
            _click_args(ev.args)
            continue
        for m in ev.mods:
            key_down(m)
        if ev.action == "down":
            key_down(ev.key)
        elif ev.action == "up":
            key_up(ev.key)
        else:
            for _ in range(ev.count):
                key_down(ev.key)
                key_up(ev.key)
                if delay:
                    wait(delay)
        for m in reversed(ev.mods):
            key_up(m)


def _click_args(args) -> None:
    nums = [int(a) for a in args if a.lstrip("-").isdigit()]
    words = [a.lower() for a in args if not a.lstrip("-").isdigit()]
    button = "mouse2" if {"right", "r"} & set(words) else "mouse3" if {"middle", "m"} & set(words) else "mouse1"
    action = "down" if {"down", "d"} & set(words) else "up" if {"up", "u"} & set(words) else "tap"
    x, y = (nums[0], nums[1]) if len(nums) >= 2 else (None, None)
    count = nums[2] if len(nums) >= 3 else (nums[0] if len(nums) == 1 else 1)
    click(button, x, y, count=count, action=action)


def mouse_down(button: str = "mouse1") -> None:
    _check()
    _backend()[1].press(_pbutton(button))


def mouse_up(button: str = "mouse1") -> None:
    _backend()[1].release(_pbutton(button))


def click(button: str = "mouse1", x: int | None = None, y: int | None = None, count: int = 1,
          action: str = "tap", interval: float = 0.0) -> None:
    _check()
    if x is not None and y is not None:
        move(x, y)
    if action == "down":
        return mouse_down(button)
    if action == "up":
        return mouse_up(button)
    for i in range(max(1, int(count))):
        _check()
        _backend()[1].click(_pbutton(button))
        if interval and i < count - 1:
            wait(interval)


def move(x: int, y: int, relative: bool = False) -> None:
    _check()
    m = _backend()[1]
    if relative:
        m.move(int(x), int(y))
    else:
        m.position = (int(x), int(y))


def position() -> tuple[int, int]:
    x, y = _backend()[1].position
    return int(x), int(y)


def scroll(dy: int = -1, dx: int = 0) -> None:
    _check()
    _backend()[1].scroll(dx, dy)


# ---------------------------------------------------------------- timing
def wait(seconds: float) -> None:
    """Sleep that stops immediately when the macro is stopped, and holds while paused."""
    end = _time.monotonic() + max(0.0, float(seconds))
    while True:
        _check()
        left = end - _time.monotonic()
        if left <= 0:
            return
        _stop.wait(min(left, 0.05))


def wait_ms(ms: float) -> None:
    wait(float(ms) / 1000.0)


def tick() -> int:
    return int(_time.monotonic() * 1000)


def random(a, b):
    if isinstance(a, int) and isinstance(b, int):
        return _random.randint(min(a, b), max(a, b))
    return _random.uniform(a, b)


# ---------------------------------------------------------------- screen
_grabber = threading.local()


def _mss():
    if not hasattr(_grabber, "sct"):
        import mss
        _grabber.sct = mss.mss()
    return _grabber.sct


def screen_size() -> tuple[int, int]:
    mon = _mss().monitors[1]
    return mon["width"], mon["height"]


def pixel(x: int, y: int) -> tuple[int, int, int]:
    shot = _mss().grab({"left": int(x), "top": int(y), "width": 1, "height": 1})
    return tuple(shot.pixel(0, 0))


def pixel_hex(x: int, y: int, order: str = "rgb") -> str:
    r, g, b = pixel(x, y)
    return f"0x{b:02X}{g:02X}{r:02X}" if order == "bgr" else f"0x{r:02X}{g:02X}{b:02X}"


def _rgb(color, order: str = "rgb") -> tuple[int, int, int]:
    if isinstance(color, (tuple, list)):
        return tuple(int(c) for c in color[:3])
    v = int(str(color), 16) if isinstance(color, str) else int(color)
    a, b, c = (v >> 16) & 255, (v >> 8) & 255, v & 255
    return (c, b, a) if order == "bgr" else (a, b, c)


def find_color(color, region=None, variation: int = 0, order: str = "rgb"):
    """Return (x, y) of the first pixel matching color within region (x1, y1, x2, y2), else None."""
    target = _rgb(color, order)
    if region is None:
        w, h = screen_size()
        region = (0, 0, w - 1, h - 1)
    x1, y1, x2, y2 = (int(v) for v in region)
    shot = _mss().grab({"left": min(x1, x2), "top": min(y1, y2), "width": abs(x2 - x1) + 1, "height": abs(y2 - y1) + 1})
    raw, width = shot.rgb, shot.width
    tr, tg, tb = target
    for i in range(0, len(raw), 3):
        if abs(raw[i] - tr) <= variation and abs(raw[i + 1] - tg) <= variation and abs(raw[i + 2] - tb) <= variation:
            p = i // 3
            return min(x1, x2) + p % width, min(y1, y2) + p // width
    return None


def find_image(path: str, region=None, variation: int = 0):
    """Find an image on screen. Returns the top-left (x, y) or None. Needs numpy and Pillow."""
    import numpy as np
    from PIL import Image
    needle = np.asarray(Image.open(path).convert("RGB"), dtype=np.int16)
    if region is None:
        w, h = screen_size()
        region = (0, 0, w - 1, h - 1)
    x1, y1, x2, y2 = (int(v) for v in region)
    shot = _mss().grab({"left": x1, "top": y1, "width": x2 - x1 + 1, "height": y2 - y1 + 1})
    hay = np.frombuffer(shot.rgb, dtype=np.uint8).reshape(shot.height, shot.width, 3).astype(np.int16)
    nh, nw = needle.shape[:2]
    if nh > hay.shape[0] or nw > hay.shape[1]:
        return None
    first = needle[0, 0]
    cand = np.argwhere(np.all(np.abs(hay[: hay.shape[0] - nh + 1, : hay.shape[1] - nw + 1] - first) <= variation, axis=2))
    for cy, cx in cand:
        _check()
        if np.all(np.abs(hay[cy:cy + nh, cx:cx + nw] - needle) <= variation):
            return x1 + int(cx), y1 + int(cy)
    return None


# ---------------------------------------------------------------- hotkeys
_hotkeys: dict = {}
_pressed: set = set()
_listening = False
_listen_lock = threading.Lock()


def _key_name(k) -> str | None:
    try:
        from pynput.keyboard import Key
        if isinstance(k, Key):
            return normalize(k.name.replace("_l", "")) if k.name.endswith("_l") else normalize(k.name)
        ch = getattr(k, "char", None)
        if ch:
            # With ctrl held, Windows reports control characters (ctrl+a -> '\x01').
            return chr(ord(ch) + 96) if len(ch) == 1 and 1 <= ord(ch) <= 26 else ch.lower()
        if getattr(k, "vk", None) and 96 <= k.vk <= 105:
            return f"numpad{k.vk - 96}"
    except ValueError:
        return None
    return None


def _combo_for(name: str) -> str:
    base = {"ctrl_r": "ctrl", "shift_r": "shift", "alt_r": "alt", "alt_gr": "alt", "cmd_r": "cmd"}
    mods = {base.get(p, p) for p in _pressed} & {"ctrl", "alt", "shift", "cmd"}
    mods.discard(base.get(name, name))
    return "+".join([m for m in ("ctrl", "alt", "shift", "cmd") if m in mods] + [name])


def _fire(name: str, release: bool) -> None:
    if _suspended and not release:
        hk = _hotkeys.get((_combo_for(name), False))
        if not (hk and hk["always"]):
            return
    for combo in (_combo_for(name), name):
        hk = _hotkeys.get((combo, release))
        if hk:
            if hk["running"] and hk["single"]:
                return
            hk["running"] = True

            def body(hk=hk):
                try:
                    hk["fn"]()
                except MacroStopped:
                    pass
                except Exception as exc:
                    protocol.emit("log", level="error", text=f"{type(exc).__name__}: {exc}")
                finally:
                    hk["running"] = False

            threading.Thread(target=body, daemon=True).start()
            return


def _ensure_listener() -> None:
    global _listening
    with _listen_lock:
        if _listening:
            return
        _listening = True
    from pynput import keyboard, mouse

    def kp(k):
        n = _key_name(k)
        if n and n not in _pressed:
            _pressed.add(n)
            _fire(n, False)

    def kr(k):
        n = _key_name(k)
        if n:
            _pressed.discard(n)
            _fire(n, True)

    def mc(_x, _y, button, down):
        n = {"left": "mouse1", "right": "mouse2", "middle": "mouse3", "x1": "mouse4", "x2": "mouse5"}.get(button.name)
        if not n:
            return
        if down:
            _pressed.add(n)
            _fire(n, False)
        else:
            _pressed.discard(n)
            _fire(n, True)

    keyboard.Listener(on_press=kp, on_release=kr, daemon=True).start()
    mouse.Listener(on_click=mc, daemon=True).start()


def hotkey(combo: str, fn=None, on_release: bool = False, single: bool = True, always: bool = False):
    """Run fn when combo is pressed. Use as a decorator: @luger.hotkey("f1").

    single: ignore presses while the previous run is still going (like AHK's default).
    always: still fires while hotkeys are suspended (for a suspend toggle itself).
    """
    def register(f):
        _hotkeys[(normalize_combo(combo), on_release)] = {"fn": f, "running": False, "single": single, "always": always}
        protocol.emit("hotkey", combo=normalize_combo(combo))
        _ensure_listener()
        return f
    return register(fn) if fn else register


def is_pressed(key: str) -> bool:
    _ensure_listener()
    return normalize(key) in _pressed


def wait_key(key: str, down: bool = True, timeout: float | None = None) -> bool:
    _ensure_listener()
    k, start = normalize(key), _time.monotonic()
    while (k in _pressed) != down:
        if timeout is not None and _time.monotonic() - start >= timeout:
            return False
        wait(0.01)
    return True


# ---------------------------------------------------------------- timers and threads
_timers: dict = {}


def every(ms: float, fn, times: int | None = None):
    """Call fn every ms milliseconds (AHK SetTimer). Calling again with the same fn replaces it."""
    cancel(fn)
    flag = threading.Event()
    _timers[fn] = flag

    def loop():
        n = 0
        while not flag.is_set() and not _stop.is_set():
            try:
                wait_ms(abs(ms))
                if flag.is_set():
                    return
                fn()
            except MacroStopped:
                return
            except Exception as exc:
                protocol.emit("log", level="error", text=f"{type(exc).__name__}: {exc}")
            n += 1
            if ms < 0 or (times is not None and n >= times):
                return
    threading.Thread(target=loop, daemon=True).start()
    return fn


def cancel(fn) -> None:
    flag = _timers.pop(fn, None)
    if flag:
        flag.set()


def start(fn, *args):
    def body():
        try:
            fn(*args)
        except MacroStopped:
            pass
        except Exception as exc:
            protocol.emit("log", level="error", text=f"{type(exc).__name__}: {exc}")
    t = threading.Thread(target=body, daemon=True)
    t.start()
    return t


def stopping() -> bool:
    return _stop.is_set()


def run() -> None:
    """Keep the macro alive until Luger stops it."""
    try:
        while not _stop.is_set():
            _stop.wait(0.25)
    except KeyboardInterrupt:
        _stop.set()


def exit(code: int = 0) -> None:
    _stop.set()
    _resume.set()
    raise MacroStopped()


def pause_toggle() -> bool:
    if _resume.is_set():
        _resume.clear()
        protocol.emit("state", paused=True)
        return True
    _resume.set()
    protocol.emit("state", paused=False)
    return False


def suspend_toggle() -> bool:
    global _suspended
    _suspended = not _suspended
    protocol.emit("state", suspended=_suspended)
    return _suspended


# ---------------------------------------------------------------- messages
def log(*parts) -> None:
    protocol.emit("log", level="info", text=" ".join(str(p) for p in parts))


def notify(text: str, title: str | None = None) -> None:
    protocol.emit("notify", text=str(text), title=title)


# ---------------------------------------------------------------- roblox window
def _front_title() -> str:
    try:
        if _sys.platform == "win32":
            import ctypes
            u = ctypes.windll.user32
            h = u.GetForegroundWindow()
            buf = ctypes.create_unicode_buffer(256)
            u.GetWindowTextW(h, buf, 256)
            return buf.value
        if _sys.platform == "darwin":
            import Quartz
            for w in Quartz.CGWindowListCopyWindowInfo(Quartz.kCGWindowListOptionOnScreenOnly, Quartz.kCGNullWindowID):
                if w.get("kCGWindowLayer") == 0:
                    return str(w.get("kCGWindowOwnerName", ""))
        else:
            from Xlib import display
            d = display.Display()
            root = d.screen().root
            wid = root.get_full_property(d.intern_atom("_NET_ACTIVE_WINDOW"), 0).value[0]
            name = d.create_resource_object("window", wid).get_wm_name()
            return name or ""
    except Exception:
        return ""
    return ""


def roblox_active() -> bool:
    title = _front_title().lower()
    return not title or "roblox" in title or "sober" in title


def focus_roblox() -> bool:
    try:
        if _sys.platform == "win32":
            import ctypes
            h = ctypes.windll.user32.FindWindowW(None, "Roblox")
            return bool(h and ctypes.windll.user32.SetForegroundWindow(h))
        if _sys.platform == "darwin":
            return _real_run(["osascript", "-e", 'tell application "Roblox" to activate'], capture_output=True).returncode == 0
        return _real_run(["wmctrl", "-a", "Roblox"], capture_output=True).returncode == 0
    except Exception:
        return False


# ---------------------------------------------------------------- AHK helpers used by converted scripts
def cat(*parts) -> str:
    return "".join("" if p is None else str(p) for p in parts)


def substr(s, start: int, length: int | None = None) -> str:
    s = str(s)
    i = start - 1 if start > 0 else len(s) + start - 1 if start < 0 else 0
    return s[i:] if length is None else s[i:i + length] if length >= 0 else s[i:length]


def instr(hay, needle, case_sensitive: bool = False, start: int = 1) -> int:
    h, n = str(hay), str(needle)
    if not case_sensitive:
        h, n = h.lower(), n.lower()
    return h.find(n, max(0, start - 1)) + 1


floor = _math.floor
ceil = _math.ceil


def sqrt(x):
    return _math.sqrt(x)


def mod(a, b):
    """AHK Mod(): the result takes the sign of the dividend."""
    return _math.fmod(a, b) if isinstance(a, float) or isinstance(b, float) else int(_math.fmod(a, b))


def is_number(v) -> bool:
    try:
        float(str(v).strip())
        return True
    except ValueError:
        return False


def click_ahk(*args) -> None:
    """AHK Click with any mix of arguments: click_ahk('right', 100, 200), click_ahk('down')."""
    parts = []
    for a in args:
        if a is None:
            continue
        parts.extend(str(a).replace(",", " ").split())
    _click_args(parts)


def _on_stop(_msg) -> None:
    _stop.set()
    _resume.set()
    for flag in list(_timers.values()):
        flag.set()


protocol.on("stop", _on_stop)
protocol.on("pause", lambda _m: pause_toggle())
