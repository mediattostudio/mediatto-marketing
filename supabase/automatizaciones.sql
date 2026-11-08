-- Supabase → SQL Editor → New query → Run
create table if not exists automation_events (
  id text primary key,                 -- 'ig:<comment_id>' o 'fb:<comment_id>'
  provider text not null,
  item_id text,
  comment_id text,
  user_id text,
  user_name text,
  text text,
  status text not null,                -- pending | sent | repeat | error
  error text,
  clicks jsonb,
  created_at timestamptz not null default now()
);
create index if not exists automation_events_item_idx on automation_events (item_id, created_at desc);
alter table automation_events enable row level security;
