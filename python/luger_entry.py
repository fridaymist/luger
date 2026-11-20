"""Single entry point for everything the app runs: python -I luger_entry.py <tool|run|app> ...

-I keeps user site-packages and environment variables out; this file adds only Luger's
own folder to the import path.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

if __name__ == "__main__":
    mode = sys.argv.pop(1) if len(sys.argv) > 1 else ""
    if mode == "tool":
        from luger_tools.__main__ import main
        raise SystemExit(main())
    if mode == "run":
        from luger_tools.runner import main
        os._exit(main())
    if mode == "app":
        import runpy
        name = sys.argv.pop(1)
        if name not in ("autoclicker", "recorder"):
            raise SystemExit("unknown app")
        runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), "apps", name + ".py"), run_name="__main__")
        raise SystemExit(0)
    raise SystemExit("usage: luger_entry.py tool|run|app")
