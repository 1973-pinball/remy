-- Serialize cross-source duplicate review with every existing journal writer.
-- The complete food snapshot includes deleted records and historical summaries.
create function public.remy_mcp_save_entries(p_owner uuid,p_entries jsonb,p_food_snapshot jsonb default null)
returns void language plpgsql security definer set search_path='' as $$
declare item jsonb; state jsonb; current_food jsonb; prior public.remy_records; has_food boolean:=false;
begin
  perform public.remy_assert_owner(p_owner);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::text,0));
  if jsonb_typeof(p_entries) is distinct from 'array' then raise exception 'REMY_INVALID_MCP_BATCH'; end if;
  if jsonb_array_length(p_entries)<1 or jsonb_array_length(p_entries)>20 then raise exception 'REMY_INVALID_MCP_BATCH'; end if;
  state:=public.remy_operation_state(p_owner,'remy-mcp');
  if coalesce((state->>'disabled')::boolean,false) then raise exception 'REMY_MCP_DISABLED'; end if;

  for item in select * from jsonb_array_elements(p_entries) loop
    if jsonb_typeof(item) is distinct from 'object' or item->>'kind' is null or item->>'kind' not in ('meal','proposal')
       or jsonb_typeof(item->'guard') is distinct from 'object'
       or item->'guard'->>'provider' is distinct from 'remy-mcp'
       or jsonb_typeof(item->'guard'->'generation') is distinct from 'number'
       or jsonb_typeof(item->'guard'->'version') is distinct from 'number'
       or coalesce((item->>'deleted')::boolean,false)
       or item->>'id' is null or length(item->>'id')=0
       or (item->>'source' is not null and item->>'source'<>'remy-chatgpt') then
      raise exception 'REMY_INVALID_MCP_BATCH';
    end if;
    perform public.remy_assert_writable(p_owner,item->'guard');
    select * into prior from public.remy_records where owner=p_owner and id=item->>'id';
    if prior.deleted then raise exception 'REMY_MCP_DELETED'; end if;
    if item->>'kind'='proposal' then
      if item->>'id' !~* '^mcp-food-proposal:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or item->'data'->>'mode' is distinct from 'mcp-food' then raise exception 'REMY_INVALID_MCP_BATCH'; end if;
    else
      has_food:=true;
      if prior.id is null then
        if item->>'id' !~* '^mcp-food-meal:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           or item->>'source' is distinct from 'remy-chatgpt' then raise exception 'REMY_INVALID_MCP_BATCH'; end if;
      elsif jsonb_typeof(item->'expectedRevision') is distinct from 'number' then
        raise exception 'REMY_CONFLICT';
      end if;
    end if;
  end loop;

  if has_food then
    if jsonb_typeof(p_food_snapshot) is distinct from 'object' then raise exception 'REMY_FOOD_SNAPSHOT_CONFLICT'; end if;
    select coalesce(jsonb_object_agg(id,revision),'{}'::jsonb) into current_food
      from public.remy_records where owner=p_owner and kind in ('meal','dailySummary');
    if current_food is distinct from p_food_snapshot then raise exception 'REMY_FOOD_SNAPSHOT_CONFLICT'; end if;
  end if;
  perform public.remy_save_entries(p_owner,p_entries);
end $$;

revoke execute on function public.remy_mcp_save_entries(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.remy_mcp_save_entries(uuid,jsonb,jsonb) to service_role;
