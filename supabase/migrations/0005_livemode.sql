-- Mark real (live-mode) payments so test purchases never count as revenue.
alter table orders add column if not exists livemode boolean not null default false;
