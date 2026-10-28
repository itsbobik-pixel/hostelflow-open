-- The Claude API credit we buy in advance (Claude Console → Billing), as the
-- admin centre is told it: Anthropic does not tell the balance through its
-- API, so the admin centre takes these top-ups minus what Anthropic billed
-- (its Cost Report, Admin API) — or, without the Admin API key, minus our own
-- per-day AI costs (usage_daily, assistant_usage). Numbers only.
CREATE TABLE claude_topups (
  id           TEXT PRIMARY KEY,
  day          TEXT NOT NULL,          -- YYYY-MM-DD (Italy), the day of the top-up
  amount_cents INTEGER NOT NULL,       -- USD cents
  note         TEXT,
  created_by   TEXT NOT NULL,          -- admin e-mail
  created_at   INTEGER NOT NULL
);

-- What Anthropic billed per day (its Cost Report, UTC days), kept so the admin
-- page asks Anthropic at most once an hour (also refreshed by the hourly cron).
CREATE TABLE claude_cost_daily (
  day          TEXT PRIMARY KEY,       -- YYYY-MM-DD, UTC
  amount_cents REAL NOT NULL,          -- USD cents, with fractions as Anthropic gives them
  fetched_at   INTEGER NOT NULL
);
