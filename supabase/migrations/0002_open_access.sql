-- OPTIONAL reviewer/demo mode (OPEN_ACCESS=true): the app works without a login.
-- Anyone holding your publishable key can then read and write these tables. Use for grading only.
do $$
declare t text;
begin
  foreach t in array array['matches','players','match_credits','rules_config','api_cache','api_usage',
    'scoring_weights','playbook_rules','predictions','team_decisions','actual_points','weight_suggestions']
  loop
    execute format('drop policy if exists "open_demo" on %I', t);
    execute format('create policy "open_demo" on %I for all to anon using (true) with check (true)', t);
  end loop;
end $$;
