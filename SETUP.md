# Putting Luger live

The app is built. These are the steps only you (and a parent, for anything with money)
can do, in order. Each takes a few minutes. Commands run in a terminal inside the
`Luger` folder.

**Rule for money accounts:** Stripe, LootLabs, Linkvertise and Work.ink must be opened by
your parent, in their name, with their bank details. They are the legal account holder.

---

## 1. Try it first (no accounts needed)

```bash
npm install
npm run dev:offline
```

This opens Luger with pretend server data, so you can click through every screen.
It only works on your computer, never in a released build.

## 2. Supabase (the server)

1. Open your project in supabase.com. The **project ref** is the 20 letters in its URL:
   `https://<ref>.supabase.co`.
2. Find your **Roblox user id**: open your Roblox profile in a browser. The number in
   the address (`roblox.com/users/123456/profile`) is your id. This makes you the owner.
3. Generate Luger's secret keys:

```bash
node scripts/setup-secrets.mjs YOUR_PROJECT_REF YOUR_ROBLOX_ID
```

4. Connect and create the database:

```bash
npx supabase login
```

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
```

```bash
npx supabase db push
```

`.secrets.env` now holds private keys. Never share it, and never paste it into a chat.

## 3. Stripe (paid keys and crystals), with your parent

1. In Stripe, go to **Developers → API keys** and copy the **Secret key**. Put it after
   `STRIPE_SECRET_KEY=` in `.secrets.env`.
2. Go to **Settings → Payments → Adaptive Pricing** and turn it on. This shows buyers
   prices in their own currency.
3. Go to **Developers → Webhooks → Add endpoint**:
   - URL: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/stripe-webhook`
   - Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
     `invoice.paid`, `customer.subscription.deleted`, `charge.refunded`,
     `charge.dispute.created`
   - Copy the **Signing secret** into `STRIPE_WEBHOOK_SECRET=`.
4. VAT: plain Stripe does not file taxes for you. Turn on **Stripe Tax** and set
   `STRIPE_AUTOMATIC_TAX=true` to collect VAT at checkout. Ask your parent about
   registering if sales grow. If your Stripe account offers **Managed Payments**, it
   handles tax for you.

Prices are already set in the app: £4.99 a week, £9.99 a month, £19.99 lifetime, and
crystal packs from £0.49. You do not create products in Stripe.

## 4. Ad networks (free keys), with your parent

Offer all three so players can choose. You can switch any of them off later in
**Owner → Free keys**.

| Network | What to set up | Put in `.secrets.env` |
|---|---|---|
| LootLabs | Create a link whose destination is `https://lugerhub.fun/key/return/?p=lootlabs` | `LOOTLABS_LINK=` the link it gives you |
| Linkvertise | Copy your publisher user id; turn on anti-bypass and copy its token | `LINKVERTISE_USER_ID=` and `LINKVERTISE_API_TOKEN=` |
| Work.ink | Create a key-system link whose destination is `https://lugerhub.fun/key/return/?p=workink` | `WORKINK_LINK=` the link it gives you |

Payouts change a lot by country and traffic. Watch **Owner → Overview** for a week or
two, then drop the network that earns least.

## 5. Send the secrets and start the server

```bash
npx supabase secrets set --env-file .secrets.env
```

```bash
npx supabase functions deploy api checkpoint stripe-webhook --no-verify-jwt
```

## 6. The key website (lugerhub.fun) on Cloudflare

```bash
npx wrangler pages deploy web --project-name luger
```

Then, in Cloudflare: **Workers & Pages → luger → Custom domains → add `lugerhub.fun`**.

## 7. GitHub (downloads and automatic updates)

1. Create a repository called `luger` on your GitHub account.
2. Your username (fridaymist) is already filled in.
3. Upload the code. `.secrets.env` is already excluded, so it is never uploaded.
4. To release a version, change `"version"` in `package.json` (for example `0.9.1`),
   add a line to `CHANGELOG.md`, then push a tag. GitHub builds Windows, Mac and Linux
   installers by itself, and everyone's Luger updates automatically.

```bash
git tag v0.9.0
```

```bash
git push --tags
```

## 8. Discord verification

People verify at `lugerhub.fun/verify` (from **Settings → Account** in the app, or a link you post). They accept the Terms, get the Verified role and allow Luger to add them to Luger servers.

1. Go to discord.com/developers/applications → **New Application** → name it **Luger**.
2. **OAuth2** page: copy the **Client ID** into `DISCORD_CLIENT_ID=`, click **Reset Secret** and copy it into `DISCORD_CLIENT_SECRET=`. Under **Redirects** add `https://lugerhub.fun/verify/callback/` and save.
3. **Bot** page: click **Reset Token**, copy it into `DISCORD_BOT_TOKEN=`. Leave Public Bot off.
4. **OAuth2 → URL Generator**: tick `bot`, then permissions **Create Instant Invite** and **Manage Roles**. Open the generated link and add the bot to your server.
5. In your server: **Server Settings → Roles**, create a **Verified** role and drag the Luger bot's role **above** it.
6. In Discord turn on **User Settings → Advanced → Developer Mode**. Right-click your server → **Copy Server ID** into `DISCORD_GUILD_ID=`. Right-click the Verified role → **Copy Role ID** into `DISCORD_VERIFIED_ROLE_ID=`.
7. Run `npx supabase secrets set --env-file .secrets.env`.

To add everyone who verified to another server: add the Luger bot there (step 4), then use **Owner → Discord** in the app.

## 9. Optional

- **Discord status:** create an application at discord.com/developers. Add
  `"discordAppId": "<its id>"` to `luger.config.json`, and upload an art asset named
  `luger`.
- **No "unknown developer" warnings:** an Apple Developer account ($99 a year, parent)
  and a Windows code-signing certificate. Luger works without them; people just see one
  extra warning when installing.

## After launch

- Sign in with any key. To make one, use the Supabase dashboard's table editor or a free
  key from the checkpoints. Then go to **Settings → Account → Prove it's mine**. Because
  your Roblox id is the owner id, the **Owner** tab appears.
- **Owner → Keys:** make keys of any type, length, number of uses or devices, or lock
  them to one Roblox user.
- **Owner → Public scripts:** push a macro to every player.
- **Owner → Staff:** give people the Developer, Editor, Plus or Supporter badge by
  Roblox username.
