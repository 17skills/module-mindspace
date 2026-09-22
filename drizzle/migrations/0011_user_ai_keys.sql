create type public.ai_provider as enum ('openai', 'anthropic', 'google', 'openrouter');

create table public.user_ai_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider public.ai_provider not null,
  encrypted_key text not null,
  base_url text,
  model_hint text,
  last4 text not null default '',
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (user_id, provider)
);

grant select, insert, update, delete on public.user_ai_keys to authenticated;
grant all on public.user_ai_keys to service_role;

alter table public.user_ai_keys enable row level security;

create policy "own ai keys all"
  on public.user_ai_keys
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());