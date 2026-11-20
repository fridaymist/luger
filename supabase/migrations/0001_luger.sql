-- Luger schema. All app access goes through Edge Functions using the service role.
-- Row-level security is enabled on every table with no policies, so the public
-- anon key can read or write nothing directly.

create extension if not exists pgcrypto;

create table users (
  roblox_id      bigint primary key,
  username       text not null,
  display_name   text,
  verified       boolean not null default false,       -- passed profile-phrase proof
  roles          text[] not null default '{}',          -- owner, developer, editor, plus, supporter
  description    text not null default '',
  banner_url     text,
  avatar_url     text,
  profile_theme  text not null default 'brass',
  frame          text,
  effect         text,
  title          text,
  showcase       text[] not null default '{}',
  level          int not null default 1,
  xp             bigint not null default 0,
  ammo           bigint not null default 0,
  crystals       bigint not null default 0,
  luger_seconds  bigint not null default 0,
  stripe_customer text,
  last_report    timestamptz,
  banned         boolean not null default false,
  created_at     timestamptz not null default now()
);

create table devices (
  id           text primary key,                        -- sha256(machine id + salt)
  roblox_id    bigint references users(roblox_id) on delete set null,
  verified_for bigint,                                  -- roblox id this device proved ownership of
  proof_phrase text,
  proof_expires timestamptz,
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now()
);

create table keys (
  id           uuid primary key default gen_random_uuid(),
  key_hash     text not null unique,                    -- hmac-sha256(key, pepper)
  key_hint     text not null,                           -- last 4 characters, for the owner panel
  key_sealed   text,                                    -- AES-GCM sealed copy so the owner can reveal it
  label        text not null default '',
  kind         text not null check (kind in ('ad','weekly','monthly','lifetime','gift','staff')),
  duration_s   bigint,                                  -- null = lifetime
  starts_on_use boolean not null default true,
  expires_at   timestamptz,
  max_uses     int,                                     -- null = unlimited redemptions
  uses         int not null default 0,
  max_devices  int not null default 1,
  bound_roblox_id bigint,
  note         text not null default '',
  revoked      boolean not null default false,
  created_by   bigint,
  source       text not null default 'owner',           -- owner, checkpoint, stripe
  stripe_ref   text,
  created_at   timestamptz not null default now()
);
create index keys_bound on keys(bound_roblox_id);
create index keys_stripe on keys(stripe_ref);

create table key_redemptions (
  key_id     uuid references keys(id) on delete cascade,
  device_id  text references devices(id) on delete cascade,
  roblox_id  bigint,
  redeemed_at timestamptz not null default now(),
  primary key (key_id, device_id)
);

create table rate_limits (
  bucket   text primary key,
  hits     int not null default 0,
  reset_at timestamptz not null
);

create table checkpoint_sessions (
  id          uuid primary key default gen_random_uuid(),
  device_id   text not null,
  provider    text not null,
  step        int not null default 0,
  steps       int not null,
  step_token  text,
  step_started timestamptz,
  key_plain_once text,                                   -- handed to the app once, then cleared
  done        boolean not null default false,
  created_at  timestamptz not null default now()
);

create table orders (
  id          text primary key,                          -- stripe event-level object id
  roblox_id   bigint,
  product     text not null,
  amount      bigint,
  currency    text,
  status      text not null,
  key_id      uuid references keys(id),
  device_id   text,
  stripe_session text,
  key_plain_once text,                                   -- shown to the buyer once, then cleared
  created_at  timestamptz not null default now()
);
create index orders_device on orders(device_id);
create index orders_session on orders(stripe_session);

create table processed_events (id text primary key, at timestamptz not null default now());

create table games (
  universe_id  bigint primary key,
  root_place_id bigint,
  name         text,
  description  text,
  creator      text,
  icon_url     text,
  thumb_url    text,
  playing      int,
  visits       bigint,
  controls     jsonb not null default '{}',
  macro_friendly boolean not null default false,
  refreshed_at timestamptz not null default now()
);

create table macros (
  id          uuid primary key default gen_random_uuid(),
  author_id   bigint references users(roblox_id) on delete cascade,
  name        text not null,
  description text not null default '',
  universe_id bigint,
  tags        text[] not null default '{}',
  source      text not null,                             -- python only
  version     int not null default 1,
  public      boolean not null default false,            -- listed in Explore
  official    boolean not null default false,            -- pushed by staff to every user
  allow_remove boolean not null default true,
  status      text not null default 'live' check (status in ('live','held','removed')),
  scan        jsonb not null default '{}',
  installs    int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index macros_public on macros(public, status, created_at desc);

create table reviews (
  macro_id   uuid references macros(id) on delete cascade,
  author_id  bigint references users(roblox_id) on delete cascade,
  stars      int not null check (stars between 1 and 5),
  body       text not null default '',
  created_at timestamptz not null default now(),
  primary key (macro_id, author_id)
);

create table playtime (
  roblox_id   bigint references users(roblox_id) on delete cascade,
  universe_id bigint not null,
  seconds     bigint not null default 0,
  last_played timestamptz,
  primary key (roblox_id, universe_id)
);

create table user_achievements (
  roblox_id  bigint references users(roblox_id) on delete cascade,
  achievement text not null,
  earned_at  timestamptz not null default now(),
  primary key (roblox_id, achievement)
);

create table inventory (
  roblox_id bigint references users(roblox_id) on delete cascade,
  item      text not null,
  acquired_at timestamptz not null default now(),
  primary key (roblox_id, item)
);

create table reports (
  id         uuid primary key default gen_random_uuid(),
  reporter   bigint,
  target_kind text not null,                             -- macro, user, review
  target_id  text not null,
  reason     text not null,
  resolved   boolean not null default false,
  created_at timestamptz not null default now()
);

create table settings (
  key   text primary key,
  value jsonb not null
);

insert into settings(key, value) values
  ('checkpoint', '{"steps": 2, "ad_key_hours": 24, "ad_key_devices": 1, "min_seconds": 12, "providers": ["lootlabs", "linkvertise", "workink"]}'),
  ('rates', '{"base": "GBP", "rates": {"GBP": 1}, "fetched": null}'),
  ('fflags', '[]');

-- Atomic balance change; refuses to go negative.
create or replace function adjust_balance(p_user bigint, p_ammo bigint, p_crystals bigint)
returns boolean language plpgsql as $$
begin
  update users set ammo = ammo + p_ammo, crystals = crystals + p_crystals
   where roblox_id = p_user and ammo + p_ammo >= 0 and crystals + p_crystals >= 0;
  return found;
end $$;

-- Fixed-window rate limiter. Returns true when the call is allowed.
create or replace function hit_rate_limit(p_bucket text, p_max int, p_window_s int)
returns boolean language plpgsql as $$
declare r rate_limits;
begin
  insert into rate_limits(bucket, hits, reset_at)
  values (p_bucket, 0, now() + make_interval(secs => p_window_s))
  on conflict (bucket) do nothing;
  select * into r from rate_limits where bucket = p_bucket for update;
  if r.reset_at < now() then
    update rate_limits set hits = 1, reset_at = now() + make_interval(secs => p_window_s) where bucket = p_bucket;
    return true;
  end if;
  if r.hits >= p_max then return false; end if;
  update rate_limits set hits = hits + 1 where bucket = p_bucket;
  return true;
end $$;

-- Atomic key redemption counter.
create or replace function claim_key_use(p_key uuid)
returns boolean language plpgsql as $$
begin
  update keys set uses = uses + 1,
                  expires_at = case when starts_on_use and expires_at is null and duration_s is not null
                                    then now() + make_interval(secs => duration_s) else expires_at end
   where id = p_key and (max_uses is null or uses < max_uses);
  return found;
end $$;

create or replace view creator_stats as
select m.author_id,
       count(distinct m.id) filter (where m.public and m.status = 'live') as macros,
       count(r.*) as reviews,
       coalesce(avg(r.stars), 0) as avg_stars
  from macros m left join reviews r on r.macro_id = m.id
 group by m.author_id;

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

insert into storage.buckets (id, name, public) values ('profile', 'profile', true) on conflict do nothing;
