"""Luger recorder worker: records mouse and keyboard with timing and plays it back.

App -> worker: {"type": "record"}, {"type": "stop"}, {"type": "play", "events": [...], "speed": 1.0,
               "loops": 1, "hotkeys": {"record": "f9", "play": "f10"}}, {"type": "quit"}
Worker -> app: {"type": "recorder", "state": "idle|recording|playing", "count": n, "loop": i}
               {"type": "recording", "events": [...]}   when a recording finishes
Events: [t_seconds, kind, ...] with kinds kd/ku (key), md/mu (button, x, y), mv (x, y), sc (dx, dy, x, y).
"""
import json
import pathlib
import sys
import threading
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import luger  # noqa: E402
from luger import protocol  # noqa: E402

state = {"mode": "idle", "events": [], "start": 0.0, "last_move": 0.0}
stop_flag = threading.Event()
listeners = []
hotkeys = {"record": "f9", "play": "f10"}
last_play = {"events": [], "speed": 1.0, "loops": 1}
BUTTONS = {"left": "mouse1", "right": "mouse2", "middle": "mouse3"}


def publish(**extra):
    protocol.emit("recorder", state=state["mode"], count=len(state["events"]), **extra)


def now():
    return round(time.monotonic() - state["start"], 4)


def start_recording():
    from pynput import keyboard, mouse
    if state["mode"] != "idle":
        return
    state.update(mode="recording", events=[], start=time.monotonic(), last_move=0.0)
    control = {luger.keys.normalize_combo(hotkeys["record"]), luger.keys.normalize_combo(hotkeys["play"])}

    def name_of(k):
        return luger._key_name(k)

    def kd(k):
        n = name_of(k)
        if n and n not in control:
            state["events"].append([now(), "kd", n])

    def ku(k):
        n = name_of(k)
        if n and n not in control:
            state["events"].append([now(), "ku", n])

    def mv(x, y):
        t = now()
        if t - state["last_move"] >= 0.016:          # ~60 samples a second is plenty
            state["events"].append([t, "mv", int(x), int(y)])
            state["last_move"] = t

    def mc(x, y, button, down):
        b = BUTTONS.get(button.name)
        if b:
            state["events"].append([now(), "md" if down else "mu", b, int(x), int(y)])

    def sc(x, y, dx, dy):
        state["events"].append([now(), "sc", int(dx), int(dy), int(x), int(y)])

    listeners[:] = [keyboard.Listener(on_press=kd, on_release=ku), mouse.Listener(on_move=mv, on_click=mc, on_scroll=sc)]
    for listener in listeners:
        listener.start()
    publish()


def stop_recording():
    for listener in listeners:
        listener.stop()
    listeners.clear()
    state["mode"] = "idle"
    protocol.emit("recording", events=state["events"])
    publish()


def play(events, speed=1.0, loops=1):
    if state["mode"] != "idle" or not events:
        return
    stop_flag.clear()
    state["mode"] = "playing"
    last_play.update(events=events, speed=speed, loops=loops)

    def run():
        held_keys, held_buttons = set(), set()
        try:
            i = 0
            while (loops == 0 or i < loops) and not stop_flag.is_set():
                i += 1
                publish(loop=i)
                begin = time.monotonic()
                for ev in events:
                    target = begin + ev[0] / max(0.05, speed)
                    while not stop_flag.is_set():
                        left = target - time.monotonic()
                        if left <= 0:
                            break
                        stop_flag.wait(min(left, 0.02))
                    if stop_flag.is_set():
                        break
                    kind = ev[1]
                    if kind == "kd":
                        luger.key_down(ev[2]); held_keys.add(ev[2])
                    elif kind == "ku":
                        luger.key_up(ev[2]); held_keys.discard(ev[2])
                    elif kind == "mv":
                        luger.move(ev[2], ev[3])
                    elif kind == "md":
                        luger.move(ev[3], ev[4]); luger.mouse_down(ev[2]); held_buttons.add(ev[2])
                    elif kind == "mu":
                        luger.move(ev[3], ev[4]); luger.mouse_up(ev[2]); held_buttons.discard(ev[2])
                    elif kind == "sc":
                        luger.scroll(ev[3], ev[2])
        except luger.MacroStopped:
            pass
        finally:
            for k in held_keys:
                luger.key_up(k)
            for b in held_buttons:
                luger.mouse_up(b)
            state["mode"] = "idle"
            publish()

    threading.Thread(target=run, daemon=True).start()


def toggle_record():
    if state["mode"] == "recording":
        stop_recording()
    elif state["mode"] == "idle":
        start_recording()


def toggle_play():
    if state["mode"] == "playing":
        stop_flag.set()
    elif state["mode"] == "idle":
        play(last_play["events"] or state["events"], last_play["speed"], last_play["loops"])


def bind_hotkeys():
    luger._hotkeys.clear()
    luger.hotkey(hotkeys["record"], toggle_record)
    luger.hotkey(hotkeys["play"], toggle_play)


def main():
    bind_hotkeys()
    publish()
    for raw in sys.stdin:
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            continue
        t = msg.get("type")
        if t == "record":
            start_recording()
        elif t == "stop":
            if state["mode"] == "recording":
                stop_recording()
            else:
                stop_flag.set()
        elif t == "play":
            last_play.update(events=msg.get("events") or state["events"], speed=float(msg.get("speed", 1)), loops=int(msg.get("loops", 1)))
            play(last_play["events"], last_play["speed"], last_play["loops"])
        elif t == "hotkeys":
            hotkeys.update({k: v for k, v in (msg.get("hotkeys") or {}).items() if k in hotkeys and luger.keys.is_valid(v)})
            bind_hotkeys()
        elif t == "quit":
            break
    stop_flag.set()


if __name__ == "__main__":
    main()
