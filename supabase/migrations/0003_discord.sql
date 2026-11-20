-- Discord verification: links a Discord account to Luger (and optionally a Roblox account),
-- with the member's consent to be added to Luger's servers. Tokens are stored sealed.
create table discord_states (
  state       text primary key,
  roblox_id   bigint,
  created_at  timestamptz not null default now()
);

create table discord_links (
  discord_id     text primary key,
  username       text not null,
  global_name    text,
  avatar         text,
  roblox_id      bigint references users(roblox_id) on delete set null,
  access_token   text not null,            -- sealed
  refresh_token  text not null,            -- sealed
  expires_at     timestamptz not null,
  scopes         text not null,
  consent_version text not null,
  consented_at   timestamptz not null default now(),
  revoked        boolean not null default false,
  updated_at     timestamptz not null default now()
);
create index discord_links_roblox on discord_links(roblox_id);

alter table discord_states enable row level security;
alter table discord_links enable row level security;
