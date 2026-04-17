# Database Audit Playbook (W1.6)

**Scope:** Particle Terminal backend — Postgres (primary) + MongoDB (auxiliary user doc store) + Redis (cache/rate-limits).
**Audience:** On-call engineer, DBA, or CTO running a quarterly schema & index health review.
**Goal:** Keep p95 read latency under 100 ms at 5× current load and prevent the next "table full scan in prod" incident.

This is an ops playbook, not a schema diff. The actual DDL lives in `server/db/init.sql`.

---

## 1. Pre-flight checklist

Before running any EXPLAIN, capture the baseline:

1. `SELECT version();` — confirm the Postgres version the production database is actually running. Audit assumes ≥ PG 14 (for `gen_random_uuid()`, improved partitioning, multirange types). If it's older, schedule a minor-version upgrade in the same window.
2. `SHOW server_version_num;` and `SHOW shared_buffers;` — record and compare to the Render plan's documented defaults.
3. `SELECT * FROM pg_stat_database WHERE datname = current_database();` — note `xact_rollback / xact_commit`, `blks_hit / (blks_read + blks_hit)` (target > 0.99 in cache-hit ratio), and `deadlocks`.
4. `SELECT now() - pg_postmaster_start_time();` — how long since the last restart. If less than an hour, wait for pg_stat_statements to accumulate signal before auditing.

## 2. Find the slow queries (pg_stat_statements)

Enable once per cluster in `postgresql.conf`:

```
shared_preload_libraries = 'pg_stat_statements'
pg_stat_statements.track = all
pg_stat_statements.max = 10000
track_io_timing = on
```

Render-managed Postgres has the extension available; enable in DB console:

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

Top-20 offenders by total wall-time:

```sql
SELECT
  queryid,
  left(query, 140) AS query,
  calls,
  round(total_exec_time::numeric / 1000, 1) AS total_s,
  round(mean_exec_time::numeric, 2)          AS mean_ms,
  round(stddev_exec_time::numeric, 2)        AS stddev_ms,
  rows
FROM pg_stat_statements
WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
ORDER BY total_exec_time DESC
LIMIT 20;
```

Top-20 by I/O amplification (read-heavy queries that will eventually need better indexes):

```sql
SELECT
  queryid,
  left(query, 140) AS query,
  calls,
  shared_blks_read + shared_blks_hit AS pages_touched,
  round((shared_blks_read::float / NULLIF(shared_blks_read + shared_blks_hit, 0))::numeric, 3) AS miss_ratio
FROM pg_stat_statements
ORDER BY shared_blks_read + shared_blks_hit DESC
LIMIT 20;
```

A query appearing in the top-20 list of either view is a candidate for an EXPLAIN pass.

## 3. EXPLAIN checklist

For each offender, run:

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, TIMING, SETTINGS, WAL, SUMMARY)
<query with real bind parameters>;
```

Red flags in the output (each maps to a specific remediation):

| Plan symptom                                  | Likely cause                                      | Remediation |
|-----------------------------------------------|---------------------------------------------------|-------------|
| `Seq Scan` over a table >10k rows             | Missing index                                     | Add a btree index that matches the `WHERE` columns and their sort order. |
| `Seq Scan` filtered by JSONB key              | No expression index on `(settings->>'key')`       | `CREATE INDEX … ON users ((settings->>'tier'))` or move the field out of JSONB. |
| `Bitmap Heap Scan` with `Recheck Cond:` on every row | Index is too low-selectivity                | Add a composite index `(high-selectivity_col, low-selectivity_col)`; consider a partial index. |
| `Filter: …` with a large `Rows Removed`       | Post-index filter dropping too many rows          | Replace the index with a partial index matching the filter, or extend the key. |
| `Hash Join` with spill to disk                | `work_mem` too small                              | Raise session `work_mem` for the offending query only; do not raise cluster-wide. |
| `Gather Merge`  / `Parallel Seq Scan`         | Planner picked parallel scan because stats are stale | `ANALYZE <table>` and re-plan. |
| `Index Scan` but actual rows ≫ estimated      | Stale statistics                                  | `ANALYZE`, then consider raising `default_statistics_target` for that column. |
| `Sort` with `external merge Disk:`            | Query needs a pre-sorted index                    | Add a compatible btree index (column order + `ASC/DESC/NULLS FIRST` must match). |
| Any plan with `Buffers: shared read=…`  > 1000 pages | Cold cache                                   | Consider `pg_prewarm` for hot tables, or revisit the schema. |

The target, informally: every endpoint that runs synchronously in the request path should return in under 50 ms cold and under 5 ms hot. If an EXPLAIN shows more than ~50 000 pages touched per call, the query is not shippable.

## 4. Index hygiene sweep

Five queries to run every quarter.

### 4.1 Unused indexes

```sql
SELECT schemaname, relname AS table, indexrelname AS index,
       pg_size_pretty(pg_relation_size(indexrelid)) AS size,
       idx_scan
FROM pg_stat_user_indexes
JOIN pg_index USING (indexrelid)
WHERE idx_scan = 0 AND NOT indisunique AND NOT indisprimary
ORDER BY pg_relation_size(indexrelid) DESC;
```

Indexes with zero scans since the last stats reset and over 10 MB are candidates for drop. Take a second sample two weeks later before dropping anything.

### 4.2 Duplicate indexes

```sql
SELECT a.indexrelid::regclass AS idx_a,
       b.indexrelid::regclass AS idx_b,
       a.indrelid::regclass   AS table
FROM pg_index a
JOIN pg_index b
  ON  a.indrelid = b.indrelid
  AND a.indkey::text = b.indkey::text
  AND a.indexrelid < b.indexrelid;
```

Pick the one with the matching `UNIQUE`/partial predicate and drop the other.

### 4.3 Bloat estimate (heap + index)

```sql
-- pgstattuple extension — safe to run on small tables; sample on big ones.
CREATE EXTENSION IF NOT EXISTS pgstattuple;
SELECT relname, (pgstattuple(relid)).*
FROM pg_class c
JOIN pg_stat_user_tables t ON c.oid = t.relid
WHERE relkind = 'r' AND pg_table_size(c.oid) > 50 * 1024 * 1024
ORDER BY pg_table_size(c.oid) DESC
LIMIT 10;
```

If `free_percent` exceeds 30% on any table, schedule `VACUUM (FULL, VERBOSE)` during a maintenance window, or switch to `pg_repack` for zero-lock rebuild.

### 4.4 Long-running transactions

```sql
SELECT pid, now() - xact_start AS age, state, left(query, 120)
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
ORDER BY xact_start
LIMIT 10;
```

Anything older than 5 minutes in `idle in transaction` starves autovacuum and blocks ALTER TABLEs. Kill with `SELECT pg_terminate_backend(pid);` once verified.

### 4.5 Lock contention

```sql
SELECT blocked.pid       AS blocked_pid,
       blocked.query     AS blocked_query,
       blocking.pid      AS blocking_pid,
       blocking.query    AS blocking_query,
       now() - blocked.xact_start AS wait
FROM pg_stat_activity blocked
JOIN pg_stat_activity blocking ON blocking.pid = ANY(pg_blocking_pids(blocked.pid));
```

If this returns a row during peak traffic, investigate — missing index on the join column, foreign key with no index, or a migration holding `ACCESS EXCLUSIVE`.

## 5. Connection pool sizing

Particle Terminal uses `pg.Pool` in `server/db/postgres.js` with `max = 10`. The Render Postgres free/starter plans cap inbound connections around 90 (official "Standard" tier is 97); verify current cap with:

```sql
SHOW max_connections;
```

Formula (Percona / 2ndQuadrant rule of thumb):

```
app_pool_max = floor((db_max_connections - admin_reserve - replication_slots) / instances)
admin_reserve ≈ 5
```

For a 97-conn cap and 1 app instance: `floor((97 - 5 - 1) / 1) = 91`. We are deliberately under-provisioned at 10 to leave headroom for cron jobs, migration tools, and a second reader when we shard. Do not raise `pool.max` above 20 per instance without simultaneously:

1. Adding `pgBouncer` in front of the DB (transaction-pooling mode), and
2. Verifying the Render plan has been moved to a tier that supports the target concurrency (Render Pro+).

Add a gauge in Grafana on `pg_stat_activity.count` and alert if it trends to > 70% of `max_connections`.

## 6. Autovacuum threshold tuning

Default thresholds (`autovacuum_vacuum_scale_factor = 0.2`) mean a 10M-row table only vacuums after 2M dead tuples. On high-churn tables (`ai_usage_ledger`, `chat_messages`, `alerts`, `audit_log`) this causes bloat. Override per table:

```sql
ALTER TABLE ai_usage_ledger SET (
  autovacuum_vacuum_scale_factor = 0.05,      -- vacuum at 5% dead tuples
  autovacuum_analyze_scale_factor = 0.02,     -- analyze at 2%
  autovacuum_vacuum_cost_limit = 2000         -- let it work faster during off-peak
);
```

Candidates and recommended thresholds:

| Table                | scale_factor (vac / analyze) | Reason |
|----------------------|------------------------------|--------|
| `ai_usage_ledger`    | 0.05 / 0.02                  | Every chat message writes a row; grows ~50k/day at 1k DAU. |
| `audit_log`          | 0.05 / 0.02                  | Append-heavy. Query-heavy. |
| `chat_messages`      | 0.05 / 0.02                  | Same. |
| `alerts`             | 0.10 / 0.05                  | Moderate churn, infrequent reads. |
| `refresh_tokens`     | 0.05 / 0.02                  | Rotating tokens generate dead tuples. |
| `webhook_events`     | 0.10 / 0.05                  | Stripe idempotency store. |

## 7. Partitioning plan

Today `ai_usage_ledger`, `audit_log`, and `chat_messages` are single tables keyed by user + day. By the second year of growth they will each cross 100 GB and become unpleasant to vacuum.

**Plan of record:** convert to `RANGE` partitioning on `day` (for `ai_usage_ledger`) or `created_at` (for `audit_log`, `chat_messages`), monthly partitions, with a retention job that detaches + archives partitions older than 24 months.

Migration steps when we cross 30 GB on any of these tables:

1. Use `pg_partman` or `partman_extension` (Render supports extensions).
2. `CREATE TABLE ai_usage_ledger_new (LIKE ai_usage_ledger INCLUDING ALL) PARTITION BY RANGE (day);`
3. Create the first 12 monthly partitions ahead of time.
4. Copy rows in batches of 10k with `INSERT … SELECT … FROM ai_usage_ledger WHERE day BETWEEN …` inside a transaction.
5. `ALTER TABLE … RENAME` in a brief lock window.
6. Verify foreign-key equivalents and indexes on each partition.
7. Schedule `CREATE PARTITION` cron to run on the 20th of every month.

Do NOT partition before you need to; premature partitioning adds query planner overhead with no payoff.

## 8. pgvector: HNSW vs IVFFlat

The Vault (RAG) feature stores embeddings in Postgres via `pgvector`. The current schema defaults to `IVFFlat`; assess whether to move to `HNSW`:

| Dimension                         | IVFFlat                         | HNSW                                  |
|-----------------------------------|---------------------------------|---------------------------------------|
| Build time                        | Fast (seconds for 100k rows)    | Slow (minutes for 100k rows)          |
| Build memory                      | Low                             | High (proportional to `m × n`)        |
| Query latency at N=1M             | ~10–30 ms                       | ~2–5 ms                               |
| Recall at default settings        | 0.85–0.95                       | 0.95–0.99                             |
| Incremental insert                | Rebuild recommended at growth   | Incremental (just add nodes)          |
| Best for                          | Small/medium corpora (<500k)    | Growing corpora or recall-critical    |
| Parameter knobs                   | `lists` (sqrt of row count)     | `m` (16), `ef_construction` (64), `ef_search` (40) |

Decision rule:
- Corpus < 100k vectors **and** rebuilds are acceptable (nightly): **IVFFlat** with `lists = sqrt(n)`, `probes = sqrt(lists)`.
- Corpus ≥ 100k vectors **or** inserts happen all day **or** recall must be > 0.95: **HNSW** with `m = 16`, `ef_construction = 64`, tune `ef_search` per-query between 40–200.

Both indexes require:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
ANALYZE <embedding_table>;
```

and the same distance operator (`<->` for L2, `<=>` for cosine, `<#>` for inner product) used in the `CREATE INDEX` declaration and in the query `ORDER BY`.

## 9. MongoDB + Redis sidecar checks

### MongoDB (auxiliary user doc store)
- `db.users.getIndexes()` — confirm `{ username: 1 }` and `{ "apple_user_id": 1 }` exist.
- `db.stats()` — track `dataSize` vs `storageSize`. If `storageSize / dataSize > 3` on a large collection, schedule `compact`.
- Oplog utilization: `rs.printReplicationInfo()` — oplog window should exceed 48 h.

### Redis
- `INFO memory` — alert if `used_memory_rss / used_memory > 1.6` (fragmentation).
- `INFO clients` — connected_clients trending up over days indicates a leak.
- `CONFIG GET maxmemory-policy` — must be `allkeys-lru` or `allkeys-lfu` for our cache-only workload. Never `noeviction`.

## 10. Quarterly audit checklist

Run through this list every 90 days (or after any schema change that adds a table larger than 1M rows):

1. Capture `pg_stat_statements` top-20 by `total_exec_time` and by `shared_blks_read`.
2. EXPLAIN each query not already on a curated allow-list.
3. Sweep unused and duplicate indexes (§4.1–4.2); open a tracking ticket for drops.
4. Re-evaluate autovacuum thresholds (§6) against current growth.
5. Check pool utilization at p95 and p99; reduce pool before raising it.
6. Confirm HNSW/IVFFlat choice against current Vault corpus size.
7. Archive audit results to `docs/audits/<YYYY-Q#>.md` so we have a trail.

## Appendix A: Expected index inventory

As of this audit (2026-Q2) the expected index set is:

- `users` — PK `id`, unique `LOWER(username)`, unique `LOWER(email)`, unique `apple_user_id` (partial `WHERE apple_user_id IS NOT NULL`).
- `refresh_tokens` — PK `id`, index `user_id`, index `token_hash`, index `expires_at` DESC.
- `ai_usage_ledger` — composite PK `(user_id, day, model)`, index `day` DESC, index `(user_id, day)`, index `(model, day)`.
- `ai_kill_switch` — singleton row; no secondary indexes.
- `audit_log` — PK `id`, index `created_at` DESC, index `(actor_user_id, created_at)`, index `(target_user_id, created_at)`.
- `chat_messages` — PK `id`, index `(user_id, created_at DESC)`, index `(thread_id, created_at)`.
- `webhook_events` — PK `id`, unique `event_id`, index `created_at`.
- `alerts` — PK `id`, index `(user_id, active)`, index `created_at`.
- `portfolios` — PK `id`, index `user_id`.
- `vault_embeddings` — PK `id`, vector index (IVFFlat OR HNSW per §8), index `user_id`.

If the audit finds an index not on this list, decide: expected but undocumented (add here) or accidental (drop).
