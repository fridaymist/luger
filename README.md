# Luger

Macro hub, launcher and automation tools for Roblox games that allow macros.
Desktop app for Windows, macOS and Linux.

- **Going live:** follow [SETUP.md](SETUP.md).
- **Design:** [docs/design.md](docs/design.md).
- **Releases:** [CHANGELOG.md](CHANGELOG.md).

## Layout

| Folder | What it is |
|---|---|
| `src/main` | Electron main process: keys and sessions, Roblox logs, launching and FastFlags, macro and app processes, auto-update |
| `src/preload` | The only bridge between the interface and the main process |
| `src/renderer` | The interface (React). Screens are in `src/renderer/src/screens` |
| `python/luger` | The `luger` macro library: input, hotkeys, pixels, timers and `luger.ui` windows |
| `python/luger_tools` | AutoHotkey→Python converter, malware scanner, bind detection and rebinding, sandboxed runner |
| `python/apps` | Auto Clicker and Recorder workers |
| `supabase` | Database schema and server functions (`api`, `checkpoint`, `stripe-webhook`), plus the shared catalog of games, achievements, themes and items |
| `web` | lugerhub.fun: landing page, ad checkpoint pages, thank-you page |
| `scripts` | Secret setup, bundled Python download, end-to-end server test |

## Commands

| Command | Does |
|---|---|
| `npm run dev:offline` | Runs the app with pretend server data |
| `npm run dev` | Runs the app against your server (`luger.config.json`) |
| `npm run typecheck` | Type-checks the app |
| `npm run test:py` | Tests the converter, scanner and binds |
| `bash scripts/e2e.sh` | Tests the whole server on a local Supabase (needs Docker) |
| `node scripts/fetch-python.mjs` | Downloads the Python that ships inside the app |
| `npm run dist:mac` / `dist:win` / `dist:linux` | Builds installers. Normally GitHub does this when you push a version tag. |

## Adding a game

Add an entry to `supabase/functions/_shared/catalog.json` → `games`, with its place id,
its default controls, its achievements and its mastery style (`endless` or not). Then
redeploy the functions and release a new app version.
