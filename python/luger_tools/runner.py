"""Runs one macro inside a restricted Python process.

    python -I -m luger_tools.runner <macro.py> <data_dir>

The first stdin line is {"type": "init", "values": {...}} with saved window values.
Safety layers (the static scan already ran before this):
  * imports of network, process and native-code modules from the macro are refused
  * open() only works inside the macro's own data folder
  * os.system/popen/exec*/spawn*/fork and subprocess are disabled for the whole process
"""
import builtins
import json
import os
import pathlib
import runpy
import sys

BLOCKED = {"socket", "ssl", "http", "urllib", "urllib2", "urllib3", "requests", "httpx", "aiohttp", "ftplib",
           "smtplib", "poplib", "imaplib", "telnetlib", "xmlrpc", "websocket", "websockets", "asyncio", "selectors",
           "socketserver", "webbrowser", "subprocess", "multiprocessing", "pty", "ctypes", "_ctypes", "cffi",
           "winreg", "_winreg", "win32api", "win32crypt", "importlib", "imp", "runpy", "marshal", "pickle", "shelve",
           "code", "codeop", "zipimport", "pkgutil", "sqlite3", "shutil", "tempfile", "mmap"}
MACRO_NAME = "__luger_macro__"


def _from_macro(globals_) -> bool:
    return bool(globals_) and globals_.get("__name__") == MACRO_NAME


def install_sandbox(data_dir: pathlib.Path) -> None:
    import luger  # noqa: F401  — load the library (and its OS backends) before locking down
    try:
        import pynput.keyboard  # noqa: F401
        import pynput.mouse  # noqa: F401
        import mss  # noqa: F401
    except Exception:
        pass

    real_import = builtins.__import__

    def guarded_import(name, globals=None, locals=None, fromlist=(), level=0):
        if _from_macro(globals) and name.split(".")[0] in BLOCKED:
            raise ImportError(f"Luger blocks '{name}' in macros for your safety")
        return real_import(name, globals, locals, fromlist, level)

    builtins.__import__ = guarded_import

    real_open = builtins.open
    root = data_dir.resolve()

    def guarded_open(file, mode="r", *args, **kwargs):
        frame = sys._getframe(1)
        if _from_macro(frame.f_globals) and not isinstance(file, int):
            target = pathlib.Path(file)
            target = (root / target).resolve() if not target.is_absolute() else target.resolve()
            if root not in target.parents and target != root:
                raise PermissionError(f"Macros can only open files in their own folder ({root})")
            file = str(target)
        return real_open(file, mode, *args, **kwargs)

    builtins.open = guarded_open

    def refused(*_a, **_k):
        raise PermissionError("Starting other programs is blocked in Luger macros")

    for name in ("system", "popen", "execl", "execle", "execlp", "execlpe", "execv", "execve", "execvp", "execvpe",
                 "spawnl", "spawnle", "spawnlp", "spawnlpe", "spawnv", "spawnve", "spawnvp", "spawnvpe", "fork",
                 "forkpty", "startfile", "posix_spawn", "posix_spawnp", "kill", "killpg"):
        if hasattr(os, name):
            setattr(os, name, refused)
    if "subprocess" in sys.modules:
        sp = sys.modules["subprocess"]
        for name in ("Popen", "run", "call", "check_call", "check_output", "getoutput", "getstatusoutput"):
            setattr(sp, name, refused)


def main() -> int:
    macro = pathlib.Path(sys.argv[1]).resolve()
    data_dir = pathlib.Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else macro.parent
    data_dir.mkdir(parents=True, exist_ok=True)

    from luger import protocol
    real_out = sys.stdout
    protocol.OUT = real_out
    first = sys.stdin.readline()
    try:
        init = json.loads(first) if first.strip() else {}
    except json.JSONDecodeError:
        init = {}
    protocol.initial_values.update(init.get("values") or {})
    protocol.start_reader(sys.stdin)
    sys.stdout = protocol.LogWriter("info")
    sys.stderr = protocol.LogWriter("error")

    install_sandbox(data_dir)
    os.chdir(data_dir)
    protocol.emit("state", running=True)
    code = 0
    import luger
    try:
        runpy.run_path(str(macro), run_name=MACRO_NAME)
    except luger.MacroStopped:
        pass
    except SystemExit as exc:
        code = exc.code if isinstance(exc.code, int) else 0
    except BaseException as exc:
        import traceback
        tb = traceback.extract_tb(exc.__traceback__)
        where = next((f"line {f.lineno}" for f in reversed(tb) if f.filename == str(macro)), "")
        protocol.emit("log", level="error", text=f"{type(exc).__name__}: {exc} {('(' + where + ')') if where else ''}".strip())
        code = 1
    finally:
        sys.stdout.flush()
        sys.stderr.flush()
        protocol.emit("state", running=False)
    return code


if __name__ == "__main__":
    os._exit(main())
