-- 0295 — the home-screen widget's push kind (v0.421.0)
--
-- Founder: "Let's do the Android live matchup widget."
--
-- The worker enqueues kind 'widget' while a matchup is live: a DATA-ONLY push
-- (no notification) that wakes the app's background task to repaint the
-- widget. push_outbox constrains kind, so the new one has to be admitted here.
-- The list below is the previous constraint's (0273_format_push.sql) plus 'widget'.
alter table push_outbox drop constraint if exists push_outbox_kind_check;
alter table push_outbox add constraint push_outbox_kind_check
  check (kind in ('lineup', 'chat', 'trades', 'waivers', 'draft', 'members', 'format', 'widget'));
