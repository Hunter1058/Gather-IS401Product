-- REVIEW ONLY. Run as owner on LOCAL/STAGING after installing the draft migration.
-- Requires two existing Auth-linked profiles and one event. Rolls back rows;
-- PostgreSQL sequence values consumed by this rehearsal are not rolled back.
begin;
do $$
declare viewers uuid[]; event_id bigint;
begin
  select array_agg(id) into viewers from
    (select u."UserID" as id from public."User" u join auth.users a on a.id=u."UserID" limit 2) candidates;
  select "EventID" into event_id from public."Events" order by "EventID" desc limit 1;
  if coalesce(cardinality(viewers),0)<2 or event_id is null then
    raise exception 'Supply two existing local/staging profiles and an event first.';
  end if;
  perform set_config('gather.view_test_actor',viewers[1]::text,true);
  perform set_config('gather.view_test_other',viewers[2]::text,true);
  perform set_config('gather.view_test_event',event_id::text,true);
  perform set_config('gather.view_test_before',coalesce((select max("InteractionID") from public."EventInteractionLog"),0)::text,true);
  perform set_config('request.jwt.claim.sub',viewers[1]::text,true);
end; $$;
set local role authenticated;
-- An insert must succeed with no SELECT permission/RETURNING clause.
insert into public."EventInteractionLog" ("UserID","EventID","InteractionType","RecipientUserID")
values (auth.uid(),current_setting('gather.view_test_event')::bigint,'view',null);
do $$
begin
  begin
    insert into public."EventInteractionLog" ("UserID","EventID","InteractionType","RecipientUserID")
    values(current_setting('gather.view_test_other')::uuid,current_setting('gather.view_test_event')::bigint,'view',null);
    raise exception 'Forged viewer was accepted';
  exception when insufficient_privilege then null; end;
  begin
    insert into public."EventInteractionLog" ("UserID","EventID","InteractionType","RecipientUserID")
    values(auth.uid(),current_setting('gather.view_test_event')::bigint,'share',null);
    raise exception 'Share was accepted';
  exception when insufficient_privilege then null; end;
  begin
    insert into public."EventInteractionLog" ("UserID","EventID","InteractionType","RecipientUserID")
    values(auth.uid(),current_setting('gather.view_test_event')::bigint,'view',current_setting('gather.view_test_other')::uuid);
    raise exception 'Recipient was accepted';
  exception when insufficient_privilege then null; end;
  begin
    insert into public."EventInteractionLog" ("UserID","EventID","InteractionType","created_at")
    values(auth.uid(),current_setting('gather.view_test_event')::bigint,'view',now());
    raise exception 'Explicit timestamp was accepted';
  exception when insufficient_privilege then null; end;
  begin
    insert into public."EventInteractionLog" ("InteractionID","UserID","EventID","InteractionType")
    values(42,auth.uid(),current_setting('gather.view_test_event')::bigint,'view');
    raise exception 'Explicit interaction ID was accepted';
  exception when insufficient_privilege then null; end;
end; $$;
reset role;
set local role anon;
do $$ begin
  begin
    insert into public."EventInteractionLog" ("UserID","EventID","InteractionType")
    values(current_setting('gather.view_test_actor')::uuid,current_setting('gather.view_test_event')::bigint,'view');
    raise exception 'Anonymous insert was accepted';
  exception when insufficient_privilege then null; end;
end; $$;
reset role;
do $$ begin
  if (select count(*) from public."EventInteractionLog"
    where "InteractionID">current_setting('gather.view_test_before')::bigint)<>1
    or not exists(select 1 from public."EventInteractionLog"
      where "InteractionID">current_setting('gather.view_test_before')::bigint
      and "UserID"=current_setting('gather.view_test_actor')::uuid
      and "EventID"=current_setting('gather.view_test_event')::bigint
      and "InteractionType"='view' and "RecipientUserID" is null and created_at is not null) then
    raise exception 'Expected exactly one generated interaction with server timestamp';
  end if;
end; $$;
rollback;
