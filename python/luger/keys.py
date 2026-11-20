"""Key names shared by the library, the converter and bind detection.

Luger key format: lowercase names joined with '+', e.g. "f1", "ctrl+shift+e", "mouse1".
"""

MOUSE = {"mouse1": "left", "mouse2": "right", "mouse3": "middle", "mouse4": "x1", "mouse5": "x2"}

ALIASES = {
    "escape": "esc", "return": "enter", "control": "ctrl", "lcontrol": "ctrl", "lctrl": "ctrl",
    "rcontrol": "ctrl_r", "rctrl": "ctrl_r", "lshift": "shift", "rshift": "shift_r", "lalt": "alt",
    "ralt": "alt_r", "lwin": "cmd", "rwin": "cmd_r", "win": "cmd", "command": "cmd", "bs": "backspace",
    "del": "delete", "ins": "insert", "pgup": "page_up", "pgdn": "page_down", "pageup": "page_up",
    "pagedown": "page_down", "lbutton": "mouse1", "rbutton": "mouse2", "mbutton": "mouse3",
    "xbutton1": "mouse4", "xbutton2": "mouse5", "spacebar": "space", "capslock": "caps_lock",
    "numlock": "num_lock", "scrolllock": "scroll_lock", "printscreen": "print_screen", "apps": "menu",
    "appskey": "menu", "wheelup": "wheel_up", "wheeldown": "wheel_down", "wheelleft": "wheel_left",
    "wheelright": "wheel_right", "numpadenter": "enter", "left_click": "mouse1", "right_click": "mouse2",
}

NAMED = {
    "space", "enter", "esc", "tab", "backspace", "delete", "insert", "home", "end", "page_up", "page_down",
    "up", "down", "left", "right", "shift", "shift_r", "ctrl", "ctrl_r", "alt", "alt_r", "cmd", "cmd_r",
    "caps_lock", "num_lock", "scroll_lock", "print_screen", "menu", "pause",
    "wheel_up", "wheel_down", "wheel_left", "wheel_right",
} | {f"f{i}" for i in range(1, 25)} | {f"numpad{i}" for i in range(10)} | set(MOUSE)

MODIFIERS = ("ctrl", "alt", "shift", "cmd")


def normalize(name: str) -> str:
    """Normalise one key name ('LButton' -> 'mouse1', 'Escape' -> 'esc', 'A' -> 'a')."""
    n = name.strip().lower().replace(" ", "_")
    if n in ALIASES:
        return ALIASES[n]
    if len(n) == 1 or n in NAMED:
        return n
    raise ValueError(f"Unknown key: {name!r}")


def normalize_combo(combo: str) -> str:
    parts = [p for p in combo.lower().replace(" ", "").split("+") if p]
    if not parts and "+" in combo:
        return "+"
    mods = [normalize(p) for p in parts[:-1]]
    key = normalize(parts[-1]) if parts else ""
    ordered = [m for m in MODIFIERS if m in mods]
    return "+".join(ordered + [key])


def is_valid(combo: str) -> bool:
    try:
        normalize_combo(combo)
        return True
    except ValueError:
        return False
