-- PunchPay 2.1 Migration: Separate Offline Payment Simulation Columns
alter table public.payment_records
  add column if not exists payment_mode text not null default 'paypal_sandbox' check (payment_mode in ('paypal_sandbox', 'simulation')),
  add column if not exists sim_intent_id text unique,
  add column if not exists sim_authorization_id text unique,
  add column if not exists sim_capture_id text unique,
  add column if not exists sim_status text;

alter table public.payment_events
  drop constraint if exists payment_events_actor_check;

alter table public.payment_events
  add constraint payment_events_actor_check check (actor in ('homeowner', 'contractor', 'ai', 'paypal', 'webhook', 'simulation', 'system'));
