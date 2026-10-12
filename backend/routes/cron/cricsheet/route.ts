import { createClient } from '@supabase/supabase-js';
import { handle, HttpError } from '@/backend/http';
import { buildAliases, ingestZip, saveAliases } from '@/backend/services/cricsheet-ingest';

/**
 * Daily refresh of the fantasy history: pulls Cricsheet's small "recently added (7 days)" file and the
 * name register. Triggered by Vercel Cron (vercel.json). Protected by CRON_SECRET.
 */
export const GET = handle(async (req: Request) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) throw new HttpError(401, 'Not authorised.');
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) throw new HttpError(500, 'Supabase is not configured.');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

  const res = await fetch('https://cricsheet.org/downloads/recently_added_7_json.zip', { cache: 'no-store' });
  if (!res.ok) throw new HttpError(502, `Cricsheet download failed (${res.status}).`);
  const stats = await ingestZip(Buffer.from(await res.arrayBuffer()), { since: '2018-01-01', sb });

  let aliases = 0;
  const names = await fetch('https://cricsheet.org/register/names.csv', { cache: 'no-store' });
  if (names.ok) aliases = await saveAliases(sb, buildAliases(await names.text(), stats.idByName));
  return { matches: stats.matches, rows: stats.rows, skipped: stats.skips, aliasesKnown: aliases };
});
