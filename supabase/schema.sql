-- Ejecuta esto una vez en Supabase → SQL Editor → New query → Run

create table if not exists items (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists connections (
  provider text primary key,          -- 'meta' | 'tiktok'
  data jsonb not null,                -- tokens y cuentas (solo lo lee el servidor)
  updated_at timestamptz not null default now()
);

create table if not exists social_posts (
  id text primary key,                -- 'ig:123', 'fb:123', 'tiktok:123'
  provider text not null,             -- 'ig' | 'fb' | 'tiktok'
  posted_at timestamptz,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists social_posts_provider_idx on social_posts (provider, posted_at desc);

create table if not exists account_snapshots (
  provider text not null,
  day date not null,
  data jsonb not null,
  primary key (provider, day)
);

create table if not exists publications (
  id text primary key,
  status text not null default 'scheduled',
  scheduled_at timestamptz not null default now(),
  item_id text,
  media jsonb not null,
  captions jsonb not null default '{}',
  targets jsonb not null,
  locked_until timestamptz,
  media_purged boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists publications_due_idx on publications (status, scheduled_at);
-- El reloj de 5 minutos para publicar lo programado está en supabase/publicar.sql

-- La app usa la service key desde el servidor; bloqueamos todo acceso público.
alter table items enable row level security;
alter table connections enable row level security;
alter table social_posts enable row level security;
alter table account_snapshots enable row level security;
alter table publications enable row level security;
