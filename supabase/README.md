# supabase/ (database)
Run the files in `migrations/` in order in the Supabase SQL editor.
- `0001_schema.sql`: every table (matches, players, match_credits, rules_config, api_cache, predictions, team_decisions, actual_points, scoring_weights, playbook_rules, weight_suggestions, api_usage) with row-level security.
- `0002_open_access.sql`: lets the app work without a login (used for the graded demo). `0003_lock_again.sql` undoes it.
- `0004_player_match_points.sql`: fantasy points per player per match from Cricsheet.
