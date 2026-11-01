-- Actualiza estadísticas de Instagram, Facebook y TikTok cada 15 minutos aunque la app esté cerrada.
-- Supabase → SQL Editor → New query → pega esto → Run. (Cambia el Bearer si tu CRON_SECRET es otro.)
select cron.unschedule('mediatto-sync') where exists (select 1 from cron.job where jobname = 'mediatto-sync');
select cron.schedule(
  'mediatto-sync',
  '*/15 * * * *',
  $$
  select net.http_get(
    url := 'https://mediatto-marketing.vercel.app/api/sync',
    headers := jsonb_build_object('Authorization', 'Bearer TU_CRON_SECRET'),
    timeout_milliseconds := 60000
  );
  $$
);
