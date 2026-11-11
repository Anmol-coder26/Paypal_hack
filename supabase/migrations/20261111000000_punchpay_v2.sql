-- PunchPay 2.0 Sandbox Schema
-- Supports multi-project repair workflows, role-based access, evidence uploads,
-- versioned AI inspections, PayPal Orders v2 / Payments v2 tracking, webhooks, and idempotency.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  role text not null check (role in ('homeowner', 'contractor')),
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists sessions_user_idx on public.sessions (user_id);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  homeowner_id uuid not null references public.profiles(id) on delete restrict,
  contractor_id uuid not null references public.profiles(id) on delete restrict,
  title text not null,
  description text not null default '',
  location text not null default '',
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'COMPLETED', 'CANCELLED')),
  currency text not null default 'USD' check (currency = 'USD'),
  due_date text,
  is_guided_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.repair_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  description text not null,
  acceptance_criteria text not null,
  amount_minor_units integer not null check (amount_minor_units > 0 and amount_minor_units <= 1000000),
  currency text not null default 'USD' check (currency = 'USD'),
  work_status text not null default 'PENDING_EVIDENCE' check (work_status in (
    'PENDING_EVIDENCE', 'BEFORE_SUBMITTED', 'EVIDENCE_SUBMITTED',
    'AI_REVIEWED', 'CORRECTIONS_REQUESTED', 'ACCEPTED', 'REJECTED'
  )),
  payment_status text not null default 'DRAFT' check (payment_status in (
    'DRAFT', 'ORDER_CREATED', 'BUYER_APPROVAL_PENDING', 'AUTHORIZED',
    'SETTLEMENT_PENDING', 'CAPTURE_PENDING', 'CAPTURED',
    'VOID_PENDING', 'VOIDED', 'AUTHORIZATION_EXPIRED',
    'PAYMENT_FAILED', 'RECONCILIATION_REQUIRED'
  )),
  contractor_notes text not null default '',
  homeowner_feedback text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists repair_tasks_project_idx on public.repair_tasks (project_id);

create table if not exists public.evidence (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.repair_tasks(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  image_storage_path text not null,
  evidence_type text not null check (evidence_type in ('before', 'after', 'reference')),
  mime_type text not null,
  byte_size integer not null check (byte_size > 0),
  width integer,
  height integer,
  notes text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists evidence_task_idx on public.evidence (task_id, created_at desc);

create table if not exists public.ai_reviews (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.repair_tasks(id) on delete cascade,
  model text not null,
  provider text not null,
  structured_findings jsonb not null,
  recommendation text not null check (recommendation in ('accept', 'request_more_evidence', 'review_concerns')),
  review_version integer not null check (review_version >= 1),
  created_at timestamptz not null default now()
);
create index if not exists ai_reviews_task_idx on public.ai_reviews (task_id, review_version desc);

create table if not exists public.payment_records (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null unique references public.repair_tasks(id) on delete cascade,
  paypal_order_id text unique,
  paypal_authorization_id text unique,
  paypal_capture_id text unique,
  paypal_status text,
  payee_merchant_id text,
  amount_minor_units integer not null check (amount_minor_units > 0),
  currency text not null default 'USD' check (currency = 'USD'),
  payment_status text not null default 'DRAFT',
  order_attempt integer not null default 1 check (order_attempt >= 1),
  request_nonce text not null,
  authorization_created_at timestamptz,
  authorization_expires_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_record_id uuid not null references public.payment_records(id) on delete cascade,
  task_id uuid not null references public.repair_tasks(id) on delete cascade,
  actor text not null check (actor in ('homeowner', 'contractor', 'ai', 'paypal', 'webhook', 'system')),
  event_type text not null,
  paypal_event_id text unique,
  safe_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists payment_events_task_idx on public.payment_events (task_id, created_at desc);
create index if not exists payment_events_created_idx on public.payment_events (created_at desc);

create table if not exists public.decisions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.repair_tasks(id) on delete cascade,
  homeowner_id uuid not null references public.profiles(id) on delete restrict,
  decision text not null check (decision in ('accept', 'reject', 'request_corrections', 'request_evidence')),
  reason text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists decisions_task_idx on public.decisions (task_id, created_at desc);

create table if not exists public.idempotency_operations (
  id uuid primary key default gen_random_uuid(),
  operation_key text not null unique,
  payment_record_id uuid not null references public.payment_records(id) on delete cascade,
  operation_type text not null check (operation_type in ('create_order', 'authorize', 'capture', 'void')),
  status text not null check (status in ('IN_PROGRESS', 'SUCCEEDED', 'FAILED')),
  response_json jsonb,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.sessions enable row level security;
alter table public.projects enable row level security;
alter table public.repair_tasks enable row level security;
alter table public.evidence enable row level security;
alter table public.ai_reviews enable row level security;
alter table public.payment_records enable row level security;
alter table public.payment_events enable row level security;
alter table public.decisions enable row level security;
alter table public.idempotency_operations enable row level security;

revoke all on public.profiles, public.sessions, public.projects, public.repair_tasks,
  public.evidence, public.ai_reviews, public.payment_records, public.payment_events,
  public.decisions, public.idempotency_operations from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('punchpay-evidence', 'punchpay-evidence', false, 4194304, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
