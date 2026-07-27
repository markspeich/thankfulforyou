create or replace function public.repair_missing_amazon_listing_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id like 'amazon-order-item:%'
    and new.listing_id is not null
    and btrim(new.listing_id) <> ''
  then
    update public.order_items
    set
      listing_id = new.listing_id,
      source_json = jsonb_set(
        coalesce(public.order_items.source_json, '{}'::jsonb),
        '{listingId}',
        to_jsonb(new.listing_id),
        true
      )
    where id = new.id
      and workspace_id = new.workspace_id
      and (listing_id is null or btrim(listing_id) = '');
  end if;

  return new;
end;
$$;

revoke all on function public.repair_missing_amazon_listing_identity() from public;

drop trigger if exists repair_missing_amazon_listing_identity_before_insert
  on public.order_items;

create trigger repair_missing_amazon_listing_identity_before_insert
before insert on public.order_items
for each row
execute function public.repair_missing_amazon_listing_identity();
