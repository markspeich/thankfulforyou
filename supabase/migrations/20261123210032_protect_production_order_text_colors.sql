-- Text color edits are explicit and request-scoped, like color edits. Ordinary
-- design saves preserve the stored order_items.text_color under the same row
-- lock as the design metadata update; only p_text_color_updates may change it.
-- Clearing stores null, which readers resolve to the default derived from color.
-- The old two-argument overload is replaced (not data-destructive); existing
-- callers that pass only p_order_items and p_color_updates keep working.
drop function if exists public.save_production_order_items(jsonb, jsonb);

create or replace function public.save_production_order_items(
  p_order_items jsonb,
  p_color_updates jsonb default '[]'::jsonb,
  p_text_color_updates jsonb default '[]'::jsonb
) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  item jsonb;
  color_update jsonb;
  text_color_update jsonb;
  row_data public.order_items;
  saved_id text;
begin
  if jsonb_typeof(p_order_items) is distinct from 'array'
    or jsonb_typeof(p_color_updates) is distinct from 'array'
    or jsonb_typeof(p_text_color_updates) is distinct from 'array' then
    raise exception 'Order items and color updates must be arrays.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_color_updates) u
    where jsonb_typeof(u -> 'orderItemId') is distinct from 'string'
      or not exists (select 1 from jsonb_array_elements(p_order_items) i where i ->> 'id' = u ->> 'orderItemId')
      or not coalesce(((u ->> 'action' = 'clear' and not u ? 'colorName')
        or (u ->> 'action' = 'set' and jsonb_typeof(u -> 'colorName') = 'string' and btrim(u ->> 'colorName') <> '')), false)
      or u ->> 'action' is null
  ) or exists (
    select 1 from jsonb_array_elements(p_color_updates) u group by u ->> 'orderItemId' having count(*) > 1
  ) then
    raise exception 'Invalid explicit color update.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_text_color_updates) u
    where jsonb_typeof(u -> 'orderItemId') is distinct from 'string'
      or not exists (select 1 from jsonb_array_elements(p_order_items) i where i ->> 'id' = u ->> 'orderItemId')
      or not coalesce(((u ->> 'action' = 'clear' and not u ? 'textColorName')
        or (u ->> 'action' = 'set' and jsonb_typeof(u -> 'textColorName') = 'string' and btrim(u ->> 'textColorName') <> '')), false)
      or u ->> 'action' is null
  ) or exists (
    select 1 from jsonb_array_elements(p_text_color_updates) u group by u ->> 'orderItemId' having count(*) > 1
  ) then
    raise exception 'Invalid explicit text color update.' using errcode = '22023';
  end if;
  -- Deterministic ordering avoids lock inversions when batches share items.
  for item in select value from jsonb_array_elements(p_order_items) order by value ->> 'id' loop
    row_data := jsonb_populate_record(null::public.order_items, item);
    select value into color_update from jsonb_array_elements(p_color_updates)
      where value ->> 'orderItemId' = row_data.id;
    select value into text_color_update from jsonb_array_elements(p_text_color_updates)
      where value ->> 'orderItemId' = row_data.id;
    if color_update is not null then
      row_data.imported_color := case when color_update ->> 'action' = 'clear' then null else btrim(color_update ->> 'colorName') end;
    end if;
    if text_color_update is not null then
      row_data.text_color := case when text_color_update ->> 'action' = 'clear' then null else btrim(text_color_update ->> 'textColorName') end;
    end if;
    row_data.source_json := jsonb_set(coalesce(row_data.source_json, '{}'::jsonb), '{colorName}', to_jsonb(coalesce(row_data.imported_color, '')));
    row_data.source_json := jsonb_set(row_data.source_json, '{textColorName}', to_jsonb(coalesce(row_data.text_color, '')));
    saved_id := null;
    insert into public.order_items as stored (
      id, workspace_id, status, order_number, buyer_name, listing_id, transaction_id,
      imported_color, text_color, quantity, source_json, revision, updated_by, updated_at
    ) values (
      row_data.id, row_data.workspace_id, row_data.status, row_data.order_number, row_data.buyer_name,
      row_data.listing_id, row_data.transaction_id, row_data.imported_color, row_data.text_color, row_data.quantity,
      row_data.source_json, row_data.revision, row_data.updated_by, row_data.updated_at
    ) on conflict (id) do update set
      status = excluded.status, order_number = excluded.order_number, buyer_name = excluded.buyer_name,
      listing_id = excluded.listing_id, transaction_id = excluded.transaction_id, quantity = excluded.quantity,
      imported_color = case when color_update is null then stored.imported_color else excluded.imported_color end,
      text_color = case when text_color_update is null then stored.text_color else excluded.text_color end,
      source_json = jsonb_set(
        jsonb_set(excluded.source_json, '{colorName}', to_jsonb(coalesce(
          case when color_update is null then stored.imported_color else excluded.imported_color end, ''))),
        '{textColorName}', to_jsonb(coalesce(
          case when text_color_update is null then stored.text_color else excluded.text_color end, ''))),
      revision = excluded.revision, updated_by = excluded.updated_by, updated_at = excluded.updated_at
    where stored.workspace_id = excluded.workspace_id and stored.revision = excluded.revision - 1
    returning id into saved_id;
    if saved_id is null then
      raise exception 'Order item revision conflict.' using errcode = 'PT409';
    end if;
  end loop;
end;
$$;
revoke all on function public.save_production_order_items(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_production_order_items(jsonb, jsonb, jsonb) to service_role;
