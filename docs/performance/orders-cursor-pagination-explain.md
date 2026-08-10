# Orders Cursor Pagination EXPLAIN Evidence

Measured locally on 2026-08-04 against the isolated `thankfulforyou-42f4` Supabase database. The representative fixture contained 20,000 imported open order groups and 20,000 compact designs in the primary workspace, plus the normal seed and database-test rows. Tables were analyzed before measurement.

## Baseline

Before the cursor index and query refactor, `EXPLAIN (ANALYZE, BUFFERS)` around `list_workspace_order_summaries_page` reported:

| Query | Rows | Shared buffers | Temp buffers | Execution |
| --- | ---: | ---: | ---: | ---: |
| Empty search, first 50 groups | 50 | 1,867 hits | 444 read / 444 written | 133.688 ms |
| Empty search, cursor after `perf-019900` | 50 | 941 hits | 444 read / 444 written | 85.752 ms |
| Common search `RN` | 50 | 941 hits | 444 read / 444 written | 146.985 ms |
| Rare search `PERF-019999` | 1 | 794 hits | 444 read / 444 written | 186.285 ms |

The materialized eligible-items CTE caused unbounded temporary work. The function was refactored so empty-search group selection is independent from the intentionally simple search branch, eligible rows are not materialized, and selected imported/manual groups resolve their items through bounded order-number/id lookups.

## Retained index

The migration retains one expression index:

```sql
create index order_items_workspace_group_cursor_idx
  on public.order_items (
    workspace_id,
    (case when nullif(btrim(order_number), '') is null then 1 else 0 end),
    (coalesce(lower(nullif(btrim(order_number), '')), '')),
    (case
      when nullif(btrim(order_number), '') is null then 'item:' || id
      else 'order:' || order_number
    end)
  );
```

This index exactly matches the workspace predicate and complete keyset-order tuple. An internal `EXPLAIN (ANALYZE, BUFFERS)` of the empty-search group selector showed:

- First page: `Index Scan using orders_pagination_candidate_idx`, then streaming `Unique` and `Limit`; 51 source rows, 5 shared-buffer hits, 0.228 ms total.
- Deep cursor after `perf-019900`: the complete row-wise cursor appeared in `Index Cond`; 51 source rows, 4 buffer hits plus 1 read, 0.255 ms total.

The temporary measurement name `orders_pagination_candidate_idx` and the migration name `order_items_workspace_group_cursor_idx` have identical definitions. The index was retained because it changes both first and deep group selection from scan/sort work to bounded keyset index scans.

At the function boundary after the query refactor, the no-index versus indexed measurements were:

| Query | No index | With index |
| --- | --- | --- |
| Empty first page | 2,023 hits, 51.375 ms | 1,428 hits + 193 reads, 42.116 ms |
| Empty deep page | 1,023 hits, 26.144 ms | 1,003 hits, 24.595 ms |

The function-level totals include SQL-function planning and bounded item/design hydration; the group-selector plan proves the history-sensitive ordering stage stops after 51 group keys on both first and deep pages.

## Search and existing indexes

Search remains intentionally simple and is measured separately. After removing materialization, common `RN` search returned 50 groups in 54.032 ms with 1,369 shared-buffer hits. It is workspace-wide but is not claimed to be page-bounded.

No additional search, design, batch, or foreign-key index was added:

- The compact design lookup used existing `designs_order_item_id_key`: 50 rows, 84 shared-buffer hits, 0.591 ms.
- The representative active-batch lookup touched one buffer and completed in 0.028 ms. The existing unique `(batch_id, order_item_id)` constraint already supports membership lookup at scale; the tiny local table reasonably chose a sequential scan.
- No extension, search projection, maintenance trigger, or speculative covering index was introduced.
