-- Dream11 fantasy points per player per T20 match, computed from Cricsheet ball-by-ball data
-- (https://cricsheet.org, ODC-BY licence). Filled by `npm run ingest:cricsheet`. Powers the
-- "overall" and "last 10 matches" form shown on each player and the equal-weight expected-points base.
create table if not exists player_match_points (
  match_ref text not null,                 -- Cricsheet match id
  team text not null,
  name_key text not null,
  player text not null,                    -- full name as Cricsheet writes it
  opponent text not null,
  played_on date not null,
  match_type text not null,                -- T20 | IT20
  gender text,
  venue text,
  event text,
  points numeric(6,1) not null,
  bat_pos smallint,
  primary key (match_ref, team, name_key)
);
create index if not exists pmp_team_date on player_match_points (team, played_on desc);
create index if not exists pmp_player_date on player_match_points (player, played_on desc);

alter table player_match_points enable row level security;
drop policy if exists "owner_all" on player_match_points;
create policy "owner_all" on player_match_points for all to authenticated using (true) with check (true);
-- Open-access demo mode (matches 0002): the app and the import script use the anon role.
drop policy if exists "open_demo" on player_match_points;
create policy "open_demo" on player_match_points for all to anon using (true) with check (true);
