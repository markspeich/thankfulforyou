-- Isolated local database only. All fixture rows are rolled back.
begin;
do $$
declare w uuid := '11111111-1111-4111-8111-111111111111';
begin
  insert into public.order_items(id,workspace_id,order_number,status,quantity,source_json) values
    ('lifecycle-complete',w,'lifecycle-closed','complete',1,'{}'),
    ('lifecycle-skipped',w,'lifecycle-closed','skipped',1,'{}'),
    ('lifecycle-open',w,'lifecycle-partial','open',1,'{}'),
    ('lifecycle-partial-complete',w,'lifecycle-partial','complete',1,'{}'),
    ('lifecycle-partial-skipped',w,'lifecycle-partial','skipped',1,'{}');
  assert not exists(select 1 from public.list_workspace_order_summaries(w,p_status_filter=>'open',p_search_term=>'lifecycle-closed')), 'Closed group leaked into Open';
  assert (select group_status='archived' and item_count=2 from public.list_workspace_order_summaries(w,p_status_filter=>'all',p_search_term=>'lifecycle-closed')), 'Mixed terminal group not archived';
  assert (select group_status='open' and item_count=3 from public.list_workspace_order_summaries(w,p_status_filter=>'open',p_search_term=>'lifecycle-partial')), 'Partially open group missing';
  update public.order_items set status='skipped' where id='lifecycle-open';
  assert not exists(select 1 from public.list_workspace_order_summaries(w,p_status_filter=>'open',p_search_term=>'lifecycle-partial')), 'Skipped mixed group stayed open';
  assert (select status='complete' from public.order_items where id='lifecycle-partial-complete'), 'Completed item changed';
end;
$$;
select 'Order group lifecycle regression checks passed' as result;
rollback;
