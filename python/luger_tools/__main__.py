"""Tool entry point used by the Luger app.

    python -I -m luger_tools <command>    (request JSON on stdin, result JSON on stdout)

Commands: convert, scan, clean, binds, rebind, check.
"""
import json
import sys

from . import ahk2py, binds, scan


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    req = json.loads(sys.stdin.read() or "{}")
    src = req.get("source", "")
    try:
        if cmd == "convert":
            res = ahk2py.convert(src)
        elif cmd == "scan":
            res = scan.scan(src)
        elif cmd == "clean":
            res = scan.clean(src)
        elif cmd == "binds":
            found = binds.detect(src)
            res = {"binds": binds.control_matches(found, req.get("controls") or {})}
        elif cmd == "rebind":
            new_src = binds.rebind(src, req.get("changes") or {})
            res = {"source": new_src, "binds": binds.control_matches(binds.detect(new_src), req.get("controls") or {})}
        elif cmd == "check":
            try:
                compile(src, "<macro>", "exec")
                res = {"ok": True}
            except SyntaxError as exc:
                res = {"ok": False, "error": f"Line {exc.lineno}: {exc.msg}"}
        else:
            res = {"error": f"Unknown command {cmd!r}"}
    except Exception as exc:  # report, never crash silently
        res = {"error": f"{type(exc).__name__}: {exc}"}
    sys.stdout.write(json.dumps(res))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
