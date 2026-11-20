"""Luger auto clicker worker. Controlled by the app over JSON lines.

App -> worker: {"type": "config", ...settings}, {"type": "toggle"}, {"type": "quit"}
Worker -> app: {"type": "clicker", "running": bool, "clicks": int}
"""
import json
import pathlib
import random
import sys
import threading
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import luger  # noqa: E402
from luger import protocol  # noqa: E402

cfg = {
    "mode": "interval",          # interval | cps
    "interval_ms": 100,
    "cps": 10,
    "button": "mouse1",
    "double": False,
    "position": "cursor",        # cursor | fixed
    "x": 0, "y": 0,
    "limit": 0,                  # 0 = until stopped
    "jitter_ms": 0,
    "hotkey": "f6",
}
state = {"running": False, "clicks": 0}
stop_flag = threading.Event()
lock = threading.Lock()


def publish():
    protocol.emit("clicker", running=state["running"], clicks=state["clicks"])


def delay() -> float:
    base = cfg["interval_ms"] / 1000 if cfg["mode"] == "interval" else 1 / max(0.1, float(cfg["cps"]))
    j = cfg["jitter_ms"] / 1000
    return max(0.001, base + (random.uniform(-j, j) if j else 0))


def loop():
    last_pub = 0.0
    try:
        while not stop_flag.is_set():
            if cfg["position"] == "fixed":
                luger.move(int(cfg["x"]), int(cfg["y"]))
            luger.click(cfg["button"], count=2 if cfg["double"] else 1)
            state["clicks"] += 1
            if cfg["limit"] and state["clicks"] >= int(cfg["limit"]):
                break
            if time.monotonic() - last_pub > 0.2:
                publish()
                last_pub = time.monotonic()
            stop_flag.wait(delay())
    except luger.MacroStopped:
        pass
    finally:
        state["running"] = False
        publish()


def toggle():
    with lock:
        if state["running"]:
            stop_flag.set()
            return
        stop_flag.clear()
        state["running"], state["clicks"] = True, 0
        publish()
        threading.Thread(target=loop, daemon=True).start()


current_hotkey = None


def set_hotkey(combo: str):
    global current_hotkey
    if current_hotkey:
        luger._hotkeys.pop((current_hotkey, False), None)
    current_hotkey = luger.keys.normalize_combo(combo)
    luger.hotkey(current_hotkey, toggle)


def main():
    set_hotkey(cfg["hotkey"])
    publish()
    for raw in sys.stdin:
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            continue
        t = msg.get("type")
        if t == "config":
            new = {k: v for k, v in msg.items() if k in cfg}
            hk_changed = new.get("hotkey") and new["hotkey"] != cfg["hotkey"]
            cfg.update(new)
            if hk_changed:
                set_hotkey(cfg["hotkey"])
        elif t == "toggle":
            toggle()
        elif t == "quit":
            break
    stop_flag.set()


if __name__ == "__main__":
    main()
