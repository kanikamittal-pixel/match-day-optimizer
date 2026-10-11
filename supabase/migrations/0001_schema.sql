-- Match Day Optimizer schema. Run in Supabase SQL editor (or `supabase db push`).
-- Single owner: create Aryan's user in Auth > Users and DISABLE public sign-ups
-- (Auth > Providers > Email > "Allow new users to sign up" off). RLS below lets any
-- authenticated user in, which with sign-ups disabled means only Aryan.

create table if not exists matches (
  id text primary key,                       -- CricketData match id, or 'manual-<uuid>'
  name text not null,
  team_a text not null,
  team_b text not null,
  venue text,
  format text,                               -- T20 | ODI | TEST
  starts_at timestamptz,
  status text,                               -- API status text
  contest_type text not null default 'small' check (contest_type in ('small','grand')),
  toss jsonb,                                -- {winner, decision}
  xi jsonb,                                  -- {teamA:[key], teamB:[key], impact:[key], confirmed:boolean, source}
  context jsonb,                             -- Gemini+Search conditions, pitch_type, sources[]
  context_fetched_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists players (
  name_key text primary key,                 -- normalised name
  name text not null,
  team text,
  role text check (role in ('WK','BAT','AR','BOWL')),
  last_credit numeric(4,1),
  last_match_id text,
  updated_at timestamptz not null default now()
);

create table if not exists match_credits (
  match_id text not null references matches(id) on delete cascade,
  name_key text not null,
  name text not null,
  team text not null,
  role text not null check (role in ('WK','BAT','AR','BOWL')),
  credit numeric(4,1) not null,
  primary key (match_id, name_key)
);

create table if not exists rules_config (
  id int primary key default 1 check (id = 1),
  credit_cap numeric not null,
  team_size int not null,
  role_min jsonb not null,
  role_max jsonb not null,
  max_per_team int not null,
  captain_mult numeric not null,
  vc_mult numeric not null,
  updated_at timestamptz not null default now()
);

create table if not exists api_cache (
  key text primary key,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  ttl_seconds int not null
);

create table if not exists api_usage (
  day date primary key,
  hits int not null default 0
);

create table if not exists scoring_weights (
  version int primary key,
  weights jsonb not null,
  note text,
  active boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists scoring_weights_one_active on scoring_weights (active) where active;

create table if not exists playbook_rules (
  id uuid primary key default gen_random_uuid(),
  version int not null,
  situation text not null,                   -- e.g. "spinners at turning pitches"
  rule text not null,
  owner text not null default 'agent' check (owner in ('agent','aryan')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  retired_at timestamptz
);

create table if not exists predictions (
  id uuid primary key default gen_random_uuid(),
  match_id text not null references matches(id) on delete cascade,
  name_key text not null,
  player_name text not null,
  team text not null,
  role text not null,
  batting_position int,
  expected_points numeric(6,1) not null,
  reason text not null,
  stage text not null check (stage in ('pre_toss','final')),
  weights_version int,
  created_at timestamptz not null default now(),
  unique (match_id, name_key)
);

create table if not exists team_decisions (
  match_id text primary key references matches(id) on delete cascade,
  stage text not null,
  recommended jsonb not null,                -- {xi:[key], captain, vc, captain_reason, bench:[{key,reason}], total_xp, credits}
  final jsonb not null,                      -- {xi:[key], captain, vc}
  decisions jsonb not null default '[]',     -- [{kind:'swap'|'captain'|'vice', from, to, tag:'gut'|'reasoned', reason}]
  status text not null default 'draft' check (status in ('draft','final')),
  situation_keys jsonb,
  finalized_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists actual_points (
  match_id text not null references matches(id) on delete cascade,
  name_key text not null,
  player_name text not null,
  points numeric(6,1) not null,
  in_final_xi boolean not null default false,
  in_recommended_xi boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (match_id, name_key)
);

create table if not exists weight_suggestions (
  id uuid primary key default gen_random_uuid(),
  weight_key text not null,
  current_value numeric not null,
  suggested_value numeric not null,
  situation text not null,
  evidence jsonb not null,                   -- {n, bias, summary}
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_at timestamptz,
  resulting_version int,
  created_at timestamptz not null default now()
);

-- RLS: every table is private to signed-in users.
do $$
declare t text;
begin
  foreach t in array array['matches','players','match_credits','rules_config','api_cache','api_usage',
    'scoring_weights','playbook_rules','predictions','team_decisions','actual_points','weight_suggestions']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "owner_all" on %I', t);
    execute format('create policy "owner_all" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- Atomic daily counter for CricketData hits
create or replace function bump_api_usage(n int default 1) returns int
language plpgsql security invoker as $$
declare total int;
begin
  insert into api_usage(day, hits) values (current_date, n)
  on conflict (day) do update set hits = api_usage.hits + n
  returning hits into total;
  return total;
end $$;
