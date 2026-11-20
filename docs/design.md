# Luger — Design

Status: draft for owner approval · 2026-11-17

## 1. What Luger is, and why

Luger is a desktop app for Windows, macOS and Linux that brings Roblox macro tooling into one place: a game launcher (the Bootstrapper), its own auto clicker and input recorder, a Python macro library that can convert AutoHotkey scripts, a community hub for sharing macros, profiles with per-game achievements, and a cosmetics shop.

It is a product meant to earn money for its owner in two ways:

1. **Free keys** that users earn by going through ad checkpoints (LootLabs and similar), which pay the owner per completion.
2. **Paid keys and crystals** sold through a payment service that handles tax and currency and delivers instantly, with no work from the owner.

Macros are only for games that allow them. Luger never injects into Roblox, reads its memory or modifies the client. It only sends keyboard and mouse input, the same as a person would.

## 2. Goals, non-goals, anti-goals

**Goals**
- One app, three operating systems, one codebase.
- A key system that can't be bypassed by editing or patching the app, because everything of value is checked on the server (see §6).
- The owner can make unlimited keys of any kind, publish scripts that reach every user straight away, and manage staff roles, all from inside the app.
- Paid keys and crystals are delivered automatically, with prices shown in the buyer's currency.
- A look that feels designed by a person: consistent, calm, dense where it should be, built around the Luger gold.

**Non-goals (for now)**
- A mobile app.
- Anything that touches the Roblox client beyond launching it and setting the FastFlags Roblox allows.
- Running Lua or executor scripts. Luger runs Python macros only.

**Anti-goals (the project fails if these happen, even if everything "works")**
- Keys that can be shared freely or skipped with a simple patch.
- A macro from the hub that steals cookies, tokens or files.
- A UI that looks like a generic AI template (gradient blobs, glass cards everywhere, emoji icons, the "settings rectangle grid").
- Payment or ad accounts held by someone who isn't legally allowed to hold them (see §14).

## 3. Approaches considered

| Area | Options | Picked | Why |
|---|---|---|---|
| App | **Electron + React + TS** · Tauri (Rust) · Python/Qt | Electron | Easiest, one codebase for all three systems, mature auto-update, and easy to theme richly. Tauri is smaller but needs Rust and a native webview on each system. Qt looks less modern and is harder to theme. |
| Server | **Supabase** · Cloudflare Workers + D1 · own server | Supabase | Free to start. Database, login, file storage and server functions in one account. Least for the owner to run. |
| Payments | **Merchant of Record** (Stripe Managed Payments / Paddle / Lemon Squeezy) · plain Stripe | Merchant of Record | The service is legally the seller. It handles VAT and sales tax in every country and shows local currency. Plain Stripe would leave tax to the owner. |
| Key website | **Static site on Cloudflare Pages** · Supabase-hosted · GitHub Pages | Cloudflare Pages | Free, fast, custom domain, and can run small server checks for the ad checkpoints. |
| Macro runtime | **Bundled Python** · ask users to install Python | Bundled | Works out of the box, and the version is pinned so macros behave the same everywhere. |

**Payment-service choice is made at sign-up time.** As of Nov 2026 the services are in flux: Stripe bought Lemon Squeezy and launched Stripe Managed Payments, and new Lemon Squeezy sign-ups have been reported as waitlisted. The server talks to payments through one small adapter, so it can use whichever service accepts the account. Order of preference: Stripe Managed Payments → Paddle → Lemon Squeezy.

## 4. Architecture

```
┌──────────────── Luger app (Electron) ────────────────┐
│ React UI  ── IPC ──  Main process                    │
│                       ├─ Key guard (session token)   │
│                       ├─ Roblox watcher (logs)       │
│                       ├─ Launcher + FastFlags        │
│                       └─ Macro host ── Python runtime│
│                                         (sandboxed)  │
└───────────────┬──────────────────────────────────────┘
                │ HTTPS (signed session token)
┌───────────────▼──────── Supabase ────────────────────┐
│ Postgres + row-level security · Storage · Edge Fns   │
│  redeem-key · refresh-session · checkpoint · webhook │
│  scan-macro · shop · profile · admin                 │
└───────▲─────────────────────────▲────────────────────┘
        │                         │ webhooks
 Key website (Cloudflare)   Payment service (MoR)
 ad checkpoints             checkout in local currency
```

- The main process holds every secret and does all networking and file access. The interface process is sandboxed (`contextIsolation` on, `nodeIntegration` off, a strict content security policy) and can only use a small list of IPC calls.
- **Versioning:** semantic versions, starting at `0.1.0`. Each phase bumps the minor version (`0.2.0`, `0.3.0` …) and fixes bump the patch. `1.0.0` comes only after everything is finished and polished. Updates install automatically (electron-updater, from GitHub Releases). The version number appears only in Settings.

## 5. Identity: who the user is

- **Automatic detection (no input needed).** On first launch Luger reads Roblox's own log files, finds the signed-in user's ID, and looks up their username, display name and avatar through Roblox's public API. Log locations:
  - Windows: `%LOCALAPPDATA%\Roblox\logs`
  - macOS: `~/Library/Logs/Roblox`
  - Linux: through Sober, the community Roblox player for Linux, which keeps its logs under its Flatpak data folder.

  Luger **never** reads the Roblox login cookie.
- **The catch:** log files can be faked, so a detected username is enough to show a greeting and track playtime, but **not** enough for anything that matters. Privileged actions need a one-time proof of ownership:
  - **Proof:** Luger shows a short phrase, the user pastes it into their Roblox profile "About" section, and the server checks it through Roblox's public API. This takes about 20 seconds, once.
  - **Needed for:** the owner panel, staff roles, posting to Explore, reviews, buying, and the profile becoming public.
  - **Not needed for:** browsing, launching games and running macros.
- **Login session:** proof creates a Supabase account linked to the Roblox user ID (users never see a password). Keys are tied to the device and the session, not only to the username.

## 6. Key system

### Key types and properties

The owner sets all of these when making keys:
- **Name / label**
- **Custom key text** (or randomly generated)
- **Type:** ad, paid-weekly, paid-monthly, paid-lifetime, owner-gift or staff
- **Duration:** a fixed length, lifetime, or "starts on first use"
- **Max uses**
- **Max devices**
- **Bound to a Roblox user** (optional)
- **Note**
- **Quantity** (bulk-generate N keys at once)

Generated keys are saved forever in the database. The owner can search, export (CSV), extend, revoke or delete them.

Format: `LUGER-XXXX-XXXX-XXXX-XXXX` (Crockford base32, which leaves out look-alike characters, plus a check digit to catch typing errors).

### Why it can't be bypassed

1. **The database never stores a usable key.** It stores a peppered SHA-256 hash, so a database leak exposes no working keys.
2. **Redeeming happens on the server.** The `redeem-key` server function checks the hash, the expiry, the use count and the device count, and records the device (a hashed hardware fingerprint).
3. **The app gets a pass, not a "yes".** The server returns a **short-lived session token** (12 hours) signed with an Ed25519 private key that exists only on the server. The app checks the signature with the matching public key, and refreshes the token in the background.
4. **Everything of value requires a valid token on the server:**
   - downloading or updating public scripts
   - the converter and malware scan
   - Explore, profiles and the shop
   - game data caching

   Patching the app to skip the key screen gets you an empty shell. This is the only kind of key protection that actually holds, so it's the design.
5. **Rate limits and lockout:** 5 failed redeems per 10 minutes per device or IP, then a cooldown. Revoking a key ends its sessions on the next refresh.
6. **Hardening on top:**
   - code obfuscation of the main process
   - integrity check of the app files (asar hash)
   - the server's address and public key compiled in
   - certificate pinning for the API

**Honest limit:** the parts that run entirely offline (the auto clicker, the recorder) could be cracked by a determined person. They can't be shared that way at scale, because they still need a valid session to start.

### Free keys via ad checkpoints

1. In the app, the user clicks **Get a free key**. The key website opens with a one-time **checkpoint session**, made by the server and tied to that device.
2. The user picks a provider. Several are offered so users have a choice. Which ones (LootLabs, Linkvertise, Work.ink and others) gets decided by research in phase 1, scored on payout per completion, how heavy the ads feel, anti-bypass tools and payout minimum.
3. Each checkpoint (default 2, which the owner can change) sends the user through the provider's link and back. The server accepts a return only if:
   - the provider's anti-bypass check passes, where the provider has one
   - a minimum time has passed
   - the token is single-use
   - the checkpoint session matches the device
4. After the last checkpoint the server makes an `ad` key (default 24 hours, 1 device, which the owner can change). The app gets it automatically, so there's no copy-paste unless the user wants it.

### Paid keys

| Product | Base price | Key |
|---|---|---|
| Weekly | £5.99 | 7 days, renews automatically while subscribed |
| Monthly | £11.99 | 30 days, renews automatically while subscribed |
| Lifetime | £23.99 | One-off payment, never expires |

**How a purchase works:**
1. The user clicks **Buy** in the app, and checkout opens in their own currency. The payment service converts the price; the owner sets one price in pounds.
2. The payment service sends a signed **webhook** to the server's `payments-webhook` function. The server checks the signature, then makes the key, binds it to the buyer's Roblox ID, and records the order. The app picks up the key at once (live update) and the payment service's receipt email includes it too.
3. Renewals extend the same key. Cancellations, refunds and chargebacks end it at the right time automatically.
4. Each payment is processed only once, even if the same webhook arrives twice (idempotent by event ID).

The owner does nothing.

### Owner panel

The owner panel is a tab that appears only for the owner and for staff with permission. The server checks the role, so it can't be unlocked by editing the app. It contains:
- keys (create, bulk, search, revoke)
- public scripts (publish, update and push to everyone, unpublish)
- staff roles
- the moderation queue
- shop rotation and prices
- ad checkpoint settings
- sales and ad stats

## 7. Roles and badges

Staff are added by Roblox username and given a role. The server resolves the username to a user ID.

| Role | Badge | Powers |
|---|---|---|
| Owner | Luger logo, purple | Everything |
| Developer | Shield | Publish and update public scripts, moderation |
| Editor | Green plus | Publish public macros, moderation queue |
| Plus | Luger logo with a small plus at top-right | Perks set by the owner, cosmetic badge |
| Supporter (donator) | Heart | Cosmetic badge |
| Verified creator | Tick | Earned automatically (see §10) |

Badges sit next to names everywhere, the way Discord does it.

A macro added by an editor or developer can't be removed by regular users unless "Allow users to remove" is switched on in that macro's settings. That switch is visible only to staff.

## 8. Sections

### 8.1 Bootstrapper (home)

**Header:** "Good morning / afternoon / evening / night" based on local time, the user's avatar headshot, and `@username` at the top right.

**Rows, in a compact version of Roblox's home layout:**
- **Continue playing:** recent games from the Roblox watcher.
- **Your top playtime:** ranked, with hours per game, like RoGold's "top played". The data comes from Luger's own playtime tracking; on first launch Luger also reads the Roblox logs still on disk, so the list is useful from day one.
- **Popular now**
- **Macro-friendly games:** games that have macros in Luger.

**Game data is live.** Names, descriptions, icons, thumbnails and player counts come from Roblox's public web APIs (`games`, `thumbnails`, `universes`). The server caches them and refreshes every 30–60 minutes. If Roblox changes an endpoint, the fix ships from the server without an app update.

**Launch:** opens the game through Roblox's own deep link. The "Apply macro and launch" option (§8.3) starts the chosen macro once the game is detected as running.

**Tweaks:**
- FastFlags written to `ClientAppSettings.json`. Roblox only accepts flags on its allow-list, so Luger offers only those, with plain-English labels (FPS cap, graphics, lighting).
- Toggles for Discord rich presence.
- Multi-instance where it's allowed.

### 8.2 Apps

A small store of Luger's own tools. Each app shows **Install**, then **Run**.
- Installing downloads that app's module and records it.
- Each app runs in its own process with its own hotkeys, so apps never clash.
- Luger warns if two running things claim the same hotkey.

The first apps:
1. **Recorder:** Luger's own input recorder and player. It records mouse and keyboard with timing, plays back at a chosen speed and loop count, and saves recordings as files. It can also turn a recording into a Python macro.
2. **Auto clicker:**
   - interval or CPS
   - left, right or middle button
   - single or double click
   - fixed position or follow the cursor
   - click limit or timer
   - a start/stop hotkey
   - a random jitter option
3. Later: **Key spammer** and a **Pixel trigger** (react when a screen colour changes).

All apps take on the current theme, including custom backgrounds. None of them copies the names, icons or layouts of existing tools.

### 8.3 Macros

**Library views:** grid or list, a strong search (name, game, tags, author), filters by game and source (mine / public / hub) and sorting.

**Each macro has:**
- **Run / Stop**
- **Apply and launch game**
- **Edit:**
  - name, description, game, tags
  - specifications (settings the script exposes)
  - key binds
- **Select mode:** a toggle that puts tick-boxes on items, with bulk actions for remove, move to a game, edit tags and export.

**Adding a macro:**
1. Drag in a `.py`, `.ahk` (v1 or v2) or recorder file.
2. AHK files are **converted to Python** (see below).
3. Every file is **scanned for malware** (§9).
4. The user picks the game the macro is for, from a search of Roblox games.
5. Key binds are **detected automatically**: Luger reads the script's structure (its syntax tree) to find hotkeys and keys it sends.

**Rebinding:**
- Changing a bind rewrites the script itself, through the syntax tree, never through find-and-replace.
- Choosing the game loads that game's **control profile** (its real default binds, researched per game). That way Luger knows which keys belong to the game and which are the macro's own hotkeys, and only real binds can be edited.

**AHK → Python converter:**
- Works on a parsed version of the script, not text replacement.
- Covers hotkeys, Send/SendInput, Click, MouseMove, Sleep, Loop, While, If, variables, functions, SetTimer, PixelGetColor/PixelSearch, ImageSearch, toggles, `#IfWinActive`, and basic `Gui` windows.
- The output uses Luger's small Python library `luger` (input, timing, pixels, hotkeys, UI), so it runs the same on all three systems.
- Anything it can't convert is kept as a clearly marked comment, and a conversion report lists it.

**Macro windows inside the app:**
- Macros describe their window through `luger.ui`: toggles, sliders, keybind fields, number fields, dropdowns, buttons, labels and a log. Luger draws it with its own components and theme, in a panel inside the app.
- AHK `Gui` windows are converted into `luger.ui`.
- Python scripts that make their own tkinter windows are opened in a themed tkinter window. It isn't embedded in the app, but it matches the colours.

### 8.4 Explore

- Community hub of **Python-only** macros. Uploads are not converted, and AHK files are rejected with a pointer to the converter.
- Filters: game, date posted, rating, most used, verified creators, tags.
- Every upload goes through the server-side scan (§9). If anything is flagged, the upload is held in the staff moderation queue instead of publishing.
- Reviews: 1–5 stars plus text, one per user per macro, and users can't review their own macros.
- **Verified tick:** at least 10 published macros, at least 10 reviews across them, and an average of 4.0 stars or higher. It's recalculated automatically and can be removed by staff.
- Safety: report button, rate limits on posting, new accounts held back for 24 hours before they can post, and staff can take down any macro or user.

### 8.5 Profile

**View mode:** banner, avatar (Roblox headshot or uploaded picture), frame, display name, badges, equipped title, description, stats (macros, reviews, hours with Luger), showcase of achievements, and the **Mastery** button.

**Edit mode (from the Edit profile button) is the only place customisation happens:**
- profile picture, banner, description (moderated: word filter, plus reports and staff review)
- profile theme, frame, effect
- titles (equip)
- achievement showcase

**Themes button:**
- A round icon button at the **bottom right of the profile view**, with no text label.
- It opens the theme picker, with two tabs: **Profile** and **App**.
- Each theme is a **small preview of the real UI** in that theme, plus its name and colour swatches.
- Locked themes show how to unlock them (an achievement, or a price in ammo or crystals).
- A grey **Add** tile imports a picture as a custom **app** background. Custom backgrounds are visible only in the user's own app, never on the profile.

**Mastery menu:**
- One card per game: progress bar, level, next reward and a track of rewards.
- Some games' tracks end (with a final title) and some go on forever, depending on how that game is played.
- **Achievements are researched game by game** before they're added, so names and milestones fit each game. Example for Fisch: 0 min "Welcome to Fisch!", 1 h "Experienced Angler", and so on.
- Hard playtime goals award **titles**.

**General achievements:**
- first macro
- 10 macros
- first review received
- 10 hours, 100 hours and so on in Luger

**Rewards:** ammo, XP (which fills the user's level), themes, frames and titles.

**Anti-farming:** playtime counts only while the Roblox window is open and the user isn't idle, and the server checks that the reported time is plausible before giving rewards.

### 8.6 Marketplace

- **Daily shop:** rotates at 00:00 UTC. The server decides what's in it, so everyone sees the same shop.
- Featured section plus the regular shop.
- Items: app themes, profile themes, avatar frames, profile effects, banners and title cards.
- **Balances** at the top right, with a **+** button that opens the crystal shop.
- **Fixed prices, no randomness.** No loot boxes or gacha.
- **My call, which can be tuned in phase 7:**

  | Crystals | Price |
  |---|---|
  | 50 | £0.59 |
  | 100 | £1.19 |
  | 220 | £2.39 (+10%) |
  | 600 | £5.99 (+20%) |
  | 1,300 | £11.99 (+30%) |

  - Item prices range from 50 to 1,000 crystals.
  - Ammo prices are **25× the crystal price**. They're worth the same, but ammo is earned slowly through play and achievements, roughly 1 crystal-equivalent per 10–15 minutes of active use.
- **Local prices:** the payment service shows each buyer the price in their own currency, and the in-app crystal shop shows those local prices too.

### 8.7 Settings

Not a grid of boxes. Settings is a single **scrolling page with a sticky side index**. Settings are grouped into short sentences with inline controls, for example:

> "Start Luger when my computer starts ⏺"

The groups are:
- **General:** startup, language, notifications
- **Look:** theme, background, density, motion
- **Roblox:** FastFlags shortcut, log folder, multi-instance
- **Macros:** default hotkeys, safety level, Python info
- **Account:** Roblox link and proof, key status, purchases, sign out of devices
- **About:** **version number (the only place it appears)**, update channel, licences

## 9. Malware protection

Every macro is scanned **on the device when added**. Hub uploads are **also scanned on the server**.

1. **Static scan of the syntax tree:** flags
   - network modules (`socket`, `requests`, `urllib`)
   - starting other programs (`subprocess`, `os.system`)
   - native code (`ctypes`)
   - `eval`/`exec`/`compile`, `__import__`, `pickle`/`marshal`
   - access to browser, Discord or Roblox cookie and token folders
   - file writes outside the macro folder
2. **Obfuscation checks:**
   - high-entropy strings
   - base64, hex, zlib or rot chains that end in `exec`
   - long one-liners
   - a Python payload hidden inside a string

   Nested decoding is safely unwrapped and the result rescanned.
3. **Signature rules:** YARA-style rules for known stealer families.
4. **Result:**
   - **Clean:** added.
   - **Flagged:** the user chooses between:
     - **Keep & clean:** the flagged calls are removed from the syntax tree, with the warning "Cleaned. This macro may no longer work."
     - **Remove:** the macro is deleted from the device.
5. **Runtime sandbox (the second wall):**
   - Macros run in a separate Python process with an import guard. Network, process and native-code modules are blocked.
   - File access is limited to the macro's own folder.
   - The process gets a cleaned-up set of environment variables.
   - Only `luger`'s own input and screen functions are allowed.

**Honest limit:** no scanner catches everything. Two layers, scan plus sandbox, is the realistic standard.

## 10. Data (main tables)

| Table | Contents |
|---|---|
| `users` | Roblox ID, username, roles, proof status, level, XP, ammo, crystals |
| `devices` | Hashed hardware fingerprint |
| `keys` | Hash, label, type, duration, uses, devices, binding, revoked, created by |
| `key_redemptions` | Which key was redeemed on which device, and when |
| `orders` and `subscriptions` | Payment records |
| `checkpoint_sessions` | Free-key ad checkpoint progress |
| `macros` | Owner, game, visibility, source, current version, scan result, allow-remove switch |
| `macro_versions` | Each saved version of a macro |
| `reviews` | Stars and text per user per macro |
| `games` | Cache of Roblox game data, plus the game's control profile |
| `achievements` and `user_achievements` | Achievement definitions and who has unlocked them |
| `mastery_tracks` | Per-game progress tracks and rewards |
| `playtime_sessions` | Each tracked play session |
| `items` | Shop items |
| `inventory` | What each user owns |
| `shop_rotation` | Each day's shop |
| `reports` and `moderation_queue` | User reports and items waiting for staff review |

- Row-level security is on for every table.
- Currency balances change only through server functions, never from the app directly.

## 11. Look and feel

- **Direction:** dark graphite base (a near-black with a hint of warmth, not pure black or blue-black), **Luger gold** as the one accent colour, and purple used only for the owner badge.
- **Fonts:** one characterful font for headings and a clean font for everything else, with tabular numbers for stats and prices.
- **Logo:** the white background will be removed so the logo blends into every theme. Small sizes use a simplified outline version.
- **Avoiding the "AI made" look:**
  - Real spacing rhythm and varied card sizes, not identical rounded boxes.
  - Restrained shadows, and no glass effects or gradient blobs.
  - One icon set (Lucide or Phosphor), no emoji.
  - Small, honest motion (120–200 ms).
  - Real empty states and loading skeletons.
  - Keyboard navigation.
- **Process:** each screen is mocked up and shown to the owner before it's wired up. The `frontend-design` skill is applied to every screen, and design and UI skills will be searched for and installed at the start of phase 2.
- **Themes:** built from design tokens (colours, radii, surfaces), so a theme changes the whole app, including macro windows and apps.

## 12. Build phases (each ships a version)

| Version | Phase |
|---|---|
| 0.1 | Supabase project and schema, key engine, owner key panel (minimal), key website and ad checkpoints, payment webhook and paid keys |
| 0.2 | App shell, themes and tokens, logo, Roblox identity and proof, key screen, auto-update |
| 0.3 | Bootstrapper: live game data, launcher, playtime watcher, FastFlags |
| 0.4 | Macros: Python runtime, `luger` library, sandbox, scanner, AHK converter, rebinding, `luger.ui` |
| 0.5 | Apps: recorder and auto clicker |
| 0.6 | Explore, reviews, verified ticks, moderation, profiles |
| 0.7 | Achievements and Mastery (per-game research) |
| 0.8 | Marketplace and crystals |
| 0.9 | Settings, polish, accessibility, all three systems tested |
| 1.0 | Release |

## 13. Platform notes

- **macOS:** users must grant **Accessibility** and **Screen Recording** permission so macros can send input and read pixels. Luger walks them through it.
- **Linux:**
  - Roblox runs through **Sober**.
  - Sending input works on X11. On Wayland it needs the `uinput` route, which requires a one-time permission step that Luger explains.
- **Code signing (optional, costs money):**
  - Without it, Windows shows a SmartScreen warning and macOS needs right-click → Open the first time.
  - Signing can be added later without changing the app.

## 14. Accounts and money: setup for an under-18 owner

The owner is under 18. Payment services, ad networks and most developer programs require the account holder to be an adult who passes identity checks. **These accounts must be opened by a parent or guardian, in their own name, with their genuine agreement. That makes them the legal account holder, responsible for the account and its income.** A minor should never sign up pretending to be the parent. Doing that breaks those services' terms, and accounts get frozen with the money in them.

| Account | Who opens it | Cost | Used for |
|---|---|---|---|
| GitHub | Owner (13+ allowed) | Free | Code, releases, auto-updates |
| Supabase | Parent (safest); owner added as a team member | Free tier | Server and database |
| Cloudflare | Parent; owner as a member | Free | Key website and domain |
| Payment service (Stripe Managed Payments / Paddle / Lemon Squeezy) | **Parent**: identity check, payouts to the parent's bank | % fee per sale, no monthly fee | Paid keys and crystals |
| Ad-key networks (chosen in phase 1) | **Parent**: payouts to the parent's PayPal or bank | Free | Free-key checkpoints |
| Domain name (e.g. `luger.gg`) | Parent | About £10–£60 a year | Key website and checkout links |
| Apple Developer (optional) | Parent | $99 a year | macOS signing |

Practical points for the parent:
- **Teams:** the parent can add the owner as a team member, with their own login, in Supabase, Cloudflare and GitHub, so day-to-day work doesn't need the parent's password.
- **Secrets:** API keys from these accounts go into the server's secret settings, never into the app or the code repository.
- **Tax (UK):** the income legally belongs to whoever holds the accounts. The first £1,000 a year of trading income is covered by HMRC's trading allowance. Above that, a Self Assessment return is needed. Check HMRC's current guidance.
- **Payment service review:** describe Luger as "desktop automation and macro tool for games that permit macros". Wording that sounds like cheats or exploits is the most common reason these services reject an account.

## 15. Left to the builder (decided during each phase, shown to the owner)

- Exact ad-key providers and checkpoint count (phase 1 research).
- Which Roblox popular-games endpoint to use (they change, and are handled server-side).
- Per-game control profiles, achievements and mastery tracks (researched per game).
- Exact shop item list and the final ammo earning rate (balanced in phase 7).
- Fonts and the icon set, chosen from mockups the owner approves.

## 16. Decisions to review

1. Electron + Supabase + a Merchant of Record payment service, with Cloudflare Pages for the key site.
2. A one-time Roblox profile-phrase proof for privileged actions, because log detection alone can be faked. Detection stays automatic for everything else.
3. 12-hour signed session tokens, and everything of value checked on the server.
4. Free ad keys default to 24 hours and 1 device; paid keys are bound to the buyer's Roblox ID.
5. Crystal pack prices, ammo set at 25× the crystal price, and the daily shop resetting at 00:00 UTC.
6. Tkinter windows from arbitrary Python scripts are themed but not embedded. Only `luger.ui` windows render inside the app.
7. Version numbering starts at 0.1.0 and reaches 1.0 only at release.
