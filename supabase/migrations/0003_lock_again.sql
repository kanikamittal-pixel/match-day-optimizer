-- Run after grading to remove open access (also set OPEN_ACCESS=false in Vercel).
do $$
declare t text;
begin
  foreach t in array array['matches','players','match_credits','rules_config','api_cache','api_usage',
    'scoring_weights','playbook_rules','predictions','team_decisions','actual_points','weight_suggestions']
  loop
    execute format('drop policy if exists "open_demo" on %I', t);
  end loop;
end $$;
