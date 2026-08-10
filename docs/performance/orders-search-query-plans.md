# Orders Search Query Plan Evidence

## Final projection-backed verification (current branch)

The measurements below are retained as the **pre-projection baseline**, not as
evidence about the final implementation. They measured an earlier function body
that discovered and aggregated the workspace before keyset limiting; the final
migration instead pages the projection-backed summary or batch-visibility path.
Do not use the baseline times, buffers, or scan counts to characterize the final
empty-search implementation.

The final boundedness evidence is the exact public-function test in
`tests/db/orders-store.db.test.js`,
`keeps empty-search discovery and group hydration index-bounded after a deep
cursor`. It executes `public.list_workspace_order_summaries` through the test's
`executeExactOrdersSummaryFunction` helper; it does not substitute an
application-side reconstruction of the SQL. The test uses a deep cursor and a
requested limit of 1 for every lifecycle × batch-filter path below.

| Lifecycle filter | Batch filter | Projection index exercised |
| --- | --- | --- |
| `all` | `all` | `order_group_summaries_page_idx` |
| `open`, `complete`, `skipped` | `all` | `order_group_summaries_status_page_idx` |
| `all` | `inBatch`, `notInBatch` | `order_group_batch_visibility_page_idx` |
| `open`, `complete`, `skipped` | `inBatch`, `notInBatch` | `order_group_batch_visibility_status_page_idx` |

That is all 12 lifecycle × batch combinations. For each one, the test verifies
the exact expected group ids, a positive scan count for the listed projection
index, no scans or tuples read from `order_items_workspace_newest_group_idx`,
and no more than two returned rows. The SQL's four empty-search materialized
key paths apply `limit least(greatest(coalesce(p_requested_limit, 50), 1), 50)
+ 1` before hydration. The extra row is the `hasMore` lookahead. PostgreSQL's
index executor may read one additional tuple while satisfying that `LIMIT`, so
the test allows at most three `pg_stat_get_xact_tuples_returned` tuples for a
requested limit of 1. This is bounded executor lookahead, not an additional
page of application results.

The final empty-search SQL paths are summary lifecycle `all` or specific with
batch `all` (and the no-valid-active-batch `notInBatch` case), plus
active-batch visibility lifecycle `all` or specific with `inBatch` or
`notInBatch`.

Nonempty search remains workspace-wide and intentionally is **not**
page-work-bounded. It is a separate, correct-but-unoptimized substring-search
path; the boundedness assertions above apply only when `p_search_term` is
empty.

No final projection-backed `EXPLAIN (ANALYZE, BUFFERS)` timing or buffer
measurements have been captured in this document. The measured figures retained
below are therefore historical baseline evidence only; final plan measurements
remain a verification gap rather than values to infer or fabricate.

## Scope and environment

These measurements validate the database primitive introduced by
`supabase/migrations/20260805172414_scalable_orders_search.sql`. They were
captured on 2026-08-08 against the isolated local Supabase stack only.
Production project `oezjskcygvfyezvoulzw` was not accessed or changed.

- Supabase CLI: 2.113.0.
- PostgreSQL: 17.6, x86_64 Linux.
- Plans: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` after `ANALYZE` and one
  warm-up execution per parameter set.
- Plan visibility: PostgreSQL normally reports the migrated SQL function as
  one opaque `Function Scan`. For measurement only, the session created a
  temporary copy from `pg_get_functiondef`, removed only its `SET search_path`
  attribute, and called that exact body so PostgreSQL could inline it. The
  temporary function and fixture were deleted after measurement.
- Cache state: all representative plans reported zero shared reads. Times are
  warm-cache local measurements, not production latency forecasts.

## Representative fixture

The target workspace contained 20,000 complete order groups backed by 20,200
order items. Every hundredth order had two items so the plan exercised
whole-group pagination. The same workspace had 20,200 designs, 20,200 design
lines, and 10,200 active batch memberships. A second workspace contributed
5,000 decoy order items and designs to make workspace filtering visible.

The fixture included open, complete, and skipped groups, common `RN` buyer and
design text, and the rare historical order number `4118855809`. The deep cursor
was the key after 15,000 newer groups:

```text
sort key: 20250101012320001000:3:0000000000000000000000000000000000000000000000000000005000005000
group id: order:5000005000
```

All calls used workspace `77777777-7777-4777-8777-777777777777`, active batch
`77777777-7777-4777-8777-777777777778`, status `all`, batch filter `all`, and
requested limit 50 unless stated otherwise. The function intentionally returns
up to 51 groups so the store can derive `hasMore` and expose at most 50.

## Pre-projection representative plans (historical baseline)

| Case | Search / cursor | Execution | Rows returned | Rows examined at base scans | Buffers | Chosen index |
| --- | --- | ---: | ---: | --- | --- | --- |
| Empty search, first page | empty / none | 72.859 ms | 51 | `order_items`: 25,200 twice; `designs`: 25,200 once | 2,063 shared hits | `batch_items_active_membership_idx` index-only probes, 0 heap fetches |
| Common short term | `rn` / none | 183.876 ms | 51 | `order_items`: 25,200 twice; `designs`: 25,200 twice; `design_lines`: 20,200 | 2,939 shared hits; 469 temp reads; 470 temp writes | `batch_items_active_membership_idx` index-only probes, 0 heap fetches |
| Rare order number | `4118855809` / none | 167.006 ms | 1 | `order_items`: 25,200 twice; `designs`: 25,200 twice; `design_lines`: 20,200 | 2,731 shared hits; 469 temp reads; 470 temp writes | `batch_items_active_membership_idx` index-only probes, 0 heap fetches |
| Deep cursor | empty / after 15,000 groups | 84.014 ms | 51 | `order_items`: 25,200 twice; `designs`: 25,200 once | 2,059 shared hits | `batch_items_active_membership_idx` index-only probes, 0 heap fetches |

`Rows examined` is actual scan output plus `Rows Removed by Filter`. Each
25,200-row scan therefore includes 20,200 target-workspace rows and 5,000
decoys. The first `order_items` scan discovers and aggregates candidate groups;
the second joins page group ids back to items for hydration. The common term
produced 6,286 candidate groups before the limit; the rare term produced one.
The deep cursor reduced the post-aggregation candidates to 4,999, but it did not
reduce either base-table scan.

## Index validation

The migration initially proposed two indexes. Each was compared with the same
warm fixture by dropping only that index locally, rerunning the inlined exact
query, and recreating it before the next comparison.

| Index and case | Present | Absent | Decision |
| --- | --- | --- | --- |
| `order_items_workspace_status_order_group_idx`, empty first page | 71.323 ms; 2,063 shared hits; index not chosen | 72.050 ms; 2,063 shared hits; identical sequential scans | Remove. It did not support the expression grouping or computed ordering used by the query. |
| `batch_items_active_membership_idx`, empty first page | 70.479 ms; 2,063 shared hits; two index-only probe nodes with 0 heap fetches | 82.043 ms; 2,145 shared hits; two 10,200-row sequential scans | Retain. It materially supports compact-row active-membership hydration. |
| `batch_items_active_membership_idx`, `inBatch` first page | 72.245 ms; index-only page probes | 118.366 ms; sequential page-membership scans | Retain. It materially supports the active-batch predicate and page hydration. |

After this comparison, the unjustified order-items index was removed from the
migration. No trigram index or search extension was added.

## Superseded pre-projection finding: empty-search work is not page-bounded

The response and final hydration output are capped, but candidate discovery is
not page-bounded. Both the first empty page and the page after 15,000 groups
scan every target order item, aggregate every group, and only then apply the
cursor and limit. The derived group-id hydration join also scans all target
order items again. This did not satisfy the restart requirement in the measured
pre-projection implementation. It is not a finding about the final
projection-backed paths documented above.

Non-empty substring search was explicitly allowed to remain a separately
measured full-scan path in this release, so its scans and temporary spill are a
documented optimization candidate rather than a new trigram-index request.

## Historical corrective design for empty search

The smallest design that preserves the current cursor semantics without a
denormalized search projection or maintenance trigger is:

1. Split the migrated function into an empty-search fast path and the existing
   non-empty substring-search path.
2. Add a newest-first expression index on `order_items` beginning with
   `workspace_id`, followed by `created_at DESC`, the normalized numeric / text /
   null order sort expression, normalized group id, and `id DESC`.
3. Add a group-member expression index beginning with `workspace_id` and the
   exact `order:<order_number>` / `item:<id>` group-id expression, followed by
   `created_at DESC, id DESC`. Use it for lifecycle aggregation and page
   hydration instead of joining a computed group id to a workspace-wide scan.
4. In the empty-search branch, scan the newest-first index and accept only the
   newest representative row for each group using the group-member index.
   Apply the keyset predicate before page hydration, evaluate lifecycle and
   batch membership per candidate group, and stop at `requested_limit + 1`.
5. Keep the current full-scan branch for non-empty substring search until its
   measured latency becomes an operator problem.

This revision needs two additive expression indexes and a replacement of the
SQL function body. It does not require a new table, projection, trigger, or
extension. Because `20260805172414_scalable_orders_search.sql` has not been
applied to production, the same generated migration can be revised before
approval; no second migration file is required. Acceptance evidence should show
first-page and deep-cursor base scans staying near the page size on this fixture,
with no workspace-wide `order_items` or `designs` scan in the empty-search path.
