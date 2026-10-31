-- PUBLICAR EN REDES — ejecútalo una vez en Supabase → SQL Editor → New query → Run
-- Antes de correrlo, reemplaza TU_CRON_SECRET por el valor de CRON_SECRET que tienes en Vercel.

-- 1) Cola de publicaciones
create table if not exists publications (
  id text primary key,
  status text not null default 'scheduled',   -- scheduled | processing | done | partial | error
  scheduled_at timestamptz not null default now(),
  item_id text,                                -- pieza del calendario (opcional)
  media jsonb not null,                        -- archivos en Supabase Storage
  captions jsonb not null default '{}',        -- texto general y por red
  targets jsonb not null,                      -- estado por red: ig, fb, tiktok
  locked_until timestamptz,                    -- evita publicar doble si dos procesos coinciden
  media_purged boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists publications_due_idx on publications (status, scheduled_at);
alter table publications enable row level security;

-- 2) Reloj cada 5 minutos para publicar lo programado
--    (Vercel gratis solo permite un cron al día; Supabase sí permite cada 5 min)
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('mediatto-publicar') where exists (select 1 from cron.job where jobname = 'mediatto-publicar');
select cron.schedule(
  'mediatto-publicar',
  '*/5 * * * *',
  $$
  select net.http_get(
    url := 'https://mediatto-marketing.vercel.app/api/publish?action=tick',
    headers := jsonb_build_object('Authorization', 'Bearer TU_CRON_SECRET'),
    timeout_milliseconds := 60000
  );
  $$
);
