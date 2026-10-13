-- =====================================================================
--  Cold-call CRM  ·  micahjacobi.me/crm
--  Run this ONCE in Supabase → SQL Editor → New query → Run.
--  Safe to re-run (every statement is IF NOT EXISTS / idempotent).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- leads ----------------------------------------------------
create table if not exists crm_leads (
  id             uuid primary key default gen_random_uuid(),
  business       text not null default '',
  owner          text not null default '',
  phone          text not null default '',   -- digits only, e.g. 12035551234 (used for tel: and de-dupe)
  phone_display  text not null default '',   -- as typed / formatted for humans
  email          text not null default '',
  town           text not null default '',
  state          text not null default '',
  category       text not null default '',
  website        text not null default '',
  reviews        integer,
  stage          text not null default 'new',
  notes          text not null default '',
  custom         jsonb not null default '{}'::jsonb,  -- user-added columns live here
  next_at        timestamptz,                -- when this lead should come up in the dial queue again
  last_called_at timestamptz,
  last_outcome   text not null default '',
  call_count     integer not null default 0,
  booked_at      timestamptz,
  source         text not null default '',
  created_by     text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists crm_leads_stage_idx   on crm_leads (stage);
create index if not exists crm_leads_next_idx    on crm_leads (next_at);
create index if not exists crm_leads_phone_idx   on crm_leads (phone);
create index if not exists crm_leads_created_idx on crm_leads (created_at);

-- ---------- calls (one row per outcome logged) ------------------------
create table if not exists crm_calls (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references crm_leads(id) on delete cascade,
  outcome    text not null,                  -- no_answer | voicemail | contacted | follow_up | booked | not_interested | dnc
  note       text not null default '',
  by_user    text not null default '',
  at         timestamptz not null default now(),
  next_at    timestamptz,
  booked_at  timestamptz
);
create index if not exists crm_calls_lead_idx on crm_calls (lead_id);
create index if not exists crm_calls_at_idx   on crm_calls (at desc);

-- ---------- settings (pipeline stages, custom columns, options) --------
create table if not exists crm_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------- keep updated_at honest ------------------------------------
create or replace function crm_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists crm_leads_touch on crm_leads;
create trigger crm_leads_touch before update on crm_leads
  for each row execute function crm_touch_updated_at();

-- ---------- lock the tables down --------------------------------------
-- The site's API talks to these with the service-role key (bypasses RLS).
-- Enabling RLS with no policies means the public anon key can't read them.
alter table crm_leads    enable row level security;
alter table crm_calls    enable row level security;
alter table crm_settings enable row level security;

-- ---------- stage counts for the dashboard strip ----------------------
create or replace view crm_stage_counts as
  select stage, count(*)::int as n from crm_leads group by stage;
