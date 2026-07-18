export const postgresSchema = `
create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  environment text not null,
  actor_type text not null,
  actor_id text not null,
  action text not null,
  entity_type text not null,
  entity_id text,
  request_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  environment text not null,
  preview_id text,
  type text not null,
  payload jsonb not null,
  status text not null default 'queued',
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  request_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists jobs_claim_idx
  on jobs (status, run_after, created_at)
  where status in ('queued', 'retry');

create table if not exists incidents (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  project_id text not null,
  environment text not null,
  preview_id text,
  pull_request_number integer,
  source text not null,
  category text not null,
  severity text not null,
  status text not null default 'open',
  title text not null,
  summary text not null,
  git jsonb not null,
  deployment jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  assigned_agent text,
  attempted_fixes integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists incidents_lookup_idx
  on incidents (project_id, environment, status, created_at desc);

create table if not exists incident_events (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references incidents(id) on delete cascade,
  event_type text not null,
  actor_type text not null,
  actor_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists preview_environments (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  preview_id text not null,
  pull_request_number integer not null,
  git_branch text not null,
  git_sha text not null,
  web_url text,
  api_url text,
  database_name text,
  r2_prefix text,
  stripe_router_enabled boolean not null default false,
  sentry_tags jsonb not null default '{}'::jsonb,
  status text not null default 'provisioning',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, preview_id)
);

create table if not exists stripe_preview_ownership (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  preview_id text not null,
  stripe_object_id text not null,
  stripe_object_type text not null,
  created_at timestamptz not null default now(),
  unique (project_id, stripe_object_id)
);

create table if not exists feature_flags (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  key text not null,
  enabled boolean not null default false,
  rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, key)
);
`;

export function printPostgresSchema(): string {
  return postgresSchema.trim();
}
