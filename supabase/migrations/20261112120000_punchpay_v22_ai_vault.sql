-- PunchPay 2.2: Admin role support, encrypted server credential storage, and AI review provenance

alter table profiles
  drop constraint if exists profiles_role_check;

alter table profiles
  add constraint profiles_role_check check (role in ('homeowner', 'contractor', 'admin'));

create table if not exists server_credentials (
  provider text primary key,
  encrypted_payload text not null,
  model text,
  updated_by text,
  updated_at timestamptz not null default now()
);

alter table ai_reviews
  add column if not exists analysis_source text not null default 'gemini_live',
  add column if not exists is_genuine_ai boolean not null default true,
  add column if not exists analyzed_evidence_ids jsonb not null default '[]'::jsonb,
  add column if not exists image_hashes jsonb not null default '[]'::jsonb,
  add column if not exists input_fingerprint text;
