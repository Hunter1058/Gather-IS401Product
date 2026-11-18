-- LOCAL/STAGING ONLY, after applying the reviewed sharing migration.
-- Run as project owner. Requires an accepted pair and an unrelated third user.
-- Rolls back rows; consumed sequence values and nontransactional trigger side
-- effects are not rolled back. Inspect triggers first. Never run on production.
begin;
set local lock_timeout='10s';
do $$
declare sender uuid; recipient uuid; outsider uuid; event_id bigint;
begin
  select f."UserAID",f."UserBID" into sender,recipient from public."Friends" f
    join auth.users a on a.id=f."UserAID" join auth.users b on b.id=f."UserBID" limit 1;
  select u."UserID" into outsider from public."User" u join auth.users a on a.id=u."UserID"
    where u."UserID" not in (sender,recipient) and not exists(select 1 from public."Friends" f
      where f."UserAID"=least(sender,u."UserID") and f."UserBID"=greatest(sender,u."UserID")) limit 1;
  select "EventID" into event_id from public."Events" where "EventID">0 order by "EventID" desc limit 1;
  if sender is null or recipient is null or outsider is null or event_id is null then
    raise exception 'Provide an accepted pair, an unrelated third Auth-linked profile and an event in local/staging.';
  end if;
  perform set_config('gather.share_sender',sender::text,true);
  perform set_config('gather.share_recipient',recipient::text,true);
  perform set_config('gather.share_outsider',outsider::text,true);
  perform set_config('gather.share_event',event_id::text,true);
  perform set_config('gather.share_native_key',gen_random_uuid()::text,true);
  perform set_config('gather.share_copy_key',gen_random_uuid()::text,true);
  perform set_config('gather.share_direct_key',gen_random_uuid()::text,true);
  perform set_config('request.jwt.claim.sub',sender::text,true);
end; $$;
set local role authenticated;
select * from public.gather_share_event(current_setting('gather.share_event')::bigint,'native',null,current_setting('gather.share_native_key')::uuid);
select * from public.gather_share_event(current_setting('gather.share_event')::bigint,'copy_link',null,current_setting('gather.share_copy_key')::uuid);
select * from public.gather_share_event(current_setting('gather.share_event')::bigint,'in_app',current_setting('gather.share_recipient')::uuid,current_setting('gather.share_direct_key')::uuid);
-- Retry the same delivery: returns the same ID and must not insert another row.
select * from public.gather_share_event(current_setting('gather.share_event')::bigint,'in_app',current_setting('gather.share_recipient')::uuid,current_setting('gather.share_direct_key')::uuid);
do $$ begin
  begin
    perform public.gather_share_event(current_setting('gather.share_event')::bigint,'in_app',current_setting('gather.share_outsider')::uuid,gen_random_uuid());
    raise exception 'Nonfriend send unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  begin
    insert into public."EventInteractionLog" ("UserID","EventID","InteractionType","RecipientUserID")
      values(current_setting('gather.share_sender')::uuid,current_setting('gather.share_event')::bigint,'share',current_setting('gather.share_recipient')::uuid);
    raise exception 'Direct share INSERT unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  begin
    insert into public."EventInteractionLog" ("UserID","EventID","InteractionType","RecipientUserID")
      values(current_setting('gather.share_recipient')::uuid,current_setting('gather.share_event')::bigint,'view',null);
    raise exception 'Forged viewer unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end; $$;
reset role;
do $$
declare delivery text;
begin
  if (select count(*) from public."EventInteractionLog" where "UserID"=current_setting('gather.share_sender')::uuid
    and "ShareRequestID" in (current_setting('gather.share_native_key')::uuid,current_setting('gather.share_copy_key')::uuid,current_setting('gather.share_direct_key')::uuid)
    and "InteractionType"='share')<>3 then raise exception 'Expected exactly three OKR-compatible share records'; end if;
  if (select count(*) from public."EventInteractionLog" where "UserID"=current_setting('gather.share_sender')::uuid
    and "ShareRequestID" in (current_setting('gather.share_native_key')::uuid,current_setting('gather.share_copy_key')::uuid)
    and "RecipientUserID" is null and "ShareChannel" in ('native','copy_link'))<>2 then raise exception 'External share shape mismatch'; end if;
  select "InteractionID"::text into delivery from public."EventInteractionLog"
    where "UserID"=current_setting('gather.share_sender')::uuid and "ShareRequestID"=current_setting('gather.share_direct_key')::uuid;
  perform set_config('gather.share_delivery',delivery,true);
  perform set_config('request.jwt.claim.sub',current_setting('gather.share_recipient'),true);
end; $$;
set local role authenticated;
do $$ begin
  if not exists(select 1 from public.gather_received_event_shares(null,51) where interaction_id=current_setting('gather.share_delivery')) then
    raise exception 'Recipient cannot see the delivered share'; end if;
end; $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('gather.share_outsider'),true);
set local role authenticated;
do $$ begin
  if exists(select 1 from public.gather_received_event_shares(null,51) where interaction_id=current_setting('gather.share_delivery')) then
    raise exception 'Outsider can read someone else''s share'; end if;
  begin
    if exists(select 1 from public."EventInteractionLog") then raise exception 'Raw interaction history is readable'; end if;
  exception when insufficient_privilege then null; end;
end; $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$ begin
  begin
    perform public.gather_share_event(current_setting('gather.share_event')::bigint,'native',null,gen_random_uuid());
    raise exception 'Anonymous share unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  begin
    perform public.gather_received_event_shares(null,21);
    raise exception 'Anonymous inbox read unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end; $$;
reset role;
rollback;
