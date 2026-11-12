-- PunchPay Interactive Demo Mode: persist simulated authorization void references
alter table payment_records
  add column if not exists sim_void_id text;
