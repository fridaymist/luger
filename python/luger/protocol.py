"""JSON-lines channel between a running macro and the Luger app.

stdout carries messages to the app; stdin carries events from it. The runner swaps
sys.stdout for a log writer, so macros can use print() freely.
"""
import json
import sys
import threading

_lock = threading.Lock()
OUT = sys.__stdout__
initial_values: dict = {}
_handlers: dict = {}


def emit(kind: str, **data) -> None:
    line = json.dumps({"type": kind, **data}, default=str)
    with _lock:
        try:
            OUT.write(line + "\n")
            OUT.flush()
        except (BrokenPipeError, ValueError):
            pass


def on(kind: str, fn) -> None:
    _handlers.setdefault(kind, []).append(fn)


def dispatch(msg: dict) -> None:
    for fn in _handlers.get(msg.get("type"), []):
        try:
            fn(msg)
        except Exception as exc:  # a broken handler must never kill the reader
            emit("log", level="error", text=f"{type(exc).__name__}: {exc}")


def start_reader(stream=None) -> None:
    stream = stream or sys.stdin

    def loop():
        for raw in stream:
            raw = raw.strip()
            if not raw:
                continue
            try:
                dispatch(json.loads(raw))
            except json.JSONDecodeError:
                continue
        dispatch({"type": "stop"})

    threading.Thread(target=loop, name="luger-reader", daemon=True).start()


class LogWriter:
    def __init__(self, level: str = "info"):
        self.level = level
        self._buf = ""

    def write(self, text: str) -> int:
        self._buf += text
        while "\n" in self._buf:
            line, self._buf = self._buf.split("\n", 1)
            emit("log", level=self.level, text=line)
        return len(text)

    def flush(self) -> None:
        if self._buf:
            emit("log", level=self.level, text=self._buf)
            self._buf = ""
