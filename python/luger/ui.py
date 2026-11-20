"""Declarative macro windows. Luger draws these with its own components and theme.

    from luger import ui
    ui.window("Auto fisher")
    speed = ui.slider("speed", "Reel speed", 1, 10, default=5)
    ui.button("start", "Start", on_click=start)
    ...
    speed.value  # current value
"""
import inspect
import threading

from . import protocol

_controls: list = []
_by_id: dict = {}
_meta = {"title": None, "description": None, "status": None}
_lock = threading.Lock()


class Control:
    def __init__(self, kind: str, id: str, label: str, default=None, on_change=None, **opts):
        if id in _by_id:
            raise ValueError(f"A control with id {id!r} already exists")
        self.kind, self.id, self.label, self.opts = kind, id, label, opts
        self._value = protocol.initial_values.get(id, default)
        self._callbacks = [on_change] if on_change else []
        with _lock:
            _controls.append(self)
            _by_id[id] = self
        _publish()

    @property
    def value(self):
        return self._value

    def set(self, value) -> None:
        """Change the value from the macro side (the app updates to match)."""
        self._value = value
        protocol.emit("ui_value", id=self.id, value=value)

    def on_change(self, fn):
        self._callbacks.append(fn)
        return fn

    def _receive(self, value) -> None:
        self._value = value
        for fn in list(self._callbacks):
            threading.Thread(target=_safe, args=(fn, value), daemon=True).start()

    def spec(self) -> dict:
        return {"kind": self.kind, "id": self.id, "label": self.label, "value": self._value, **self.opts}


def _takes_arg(fn) -> bool:
    try:
        params = inspect.signature(fn).parameters.values()
    except (TypeError, ValueError):
        return True
    return any(p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD, p.VAR_POSITIONAL) for p in params)


def _safe(fn, value):
    try:
        fn(value) if _takes_arg(fn) else fn()
    except Exception as exc:
        protocol.emit("log", level="error", text=f"{type(exc).__name__}: {exc}")


def _publish() -> None:
    protocol.emit("ui", window={**_meta, "controls": [c.spec() for c in _controls]})


def _on_event(msg: dict) -> None:
    control = _by_id.get(msg.get("id"))
    if control:
        control._receive(msg.get("value"))


protocol.on("ui_event", _on_event)


def window(title: str, description: str | None = None) -> None:
    _meta["title"], _meta["description"] = title, description
    _publish()


def status(text: str) -> None:
    _meta["status"] = text
    protocol.emit("ui_status", text=text)


def toggle(id, label, default=False, on_change=None):
    return Control("toggle", id, label, bool(default), on_change)


def button(id, label, on_click=None, style="primary"):
    return Control("button", id, label, None, on_click, style=style)


def slider(id, label, min, max, default=None, step=1, unit="", on_change=None):
    return Control("slider", id, label, min if default is None else default, on_change, min=min, max=max, step=step, unit=unit)


def number(id, label, default=0, min=None, max=None, step=1, unit="", on_change=None):
    return Control("number", id, label, default, on_change, min=min, max=max, step=step, unit=unit)


def keybind(id, label, default, on_change=None):
    return Control("keybind", id, label, default, on_change)


def select(id, label, options, default=None, on_change=None):
    options = [o if isinstance(o, (list, tuple)) else (o, o) for o in options]
    return Control("select", id, label, options[0][1] if default is None else default, on_change,
                   options=[list(o) for o in options])


def text_input(id, label, default="", on_change=None):
    return Control("text", id, label, default, on_change)


def label(id, text):
    return Control("label", id, text, None)


def value(id):
    return _by_id[id].value
