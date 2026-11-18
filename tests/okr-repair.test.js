import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sharingDatabase,A,B,key} from './helpers/sharing-database.js';
const verify=await readFile(new URL('../supabase/review/complete_okr_sharing_verification.sql',import.meta.url),'utf8');
async function verified(db) {
  const rows=(await db.query(verify)).rows;
  assert(rows.length>=14);assert.deepEqual(rows.filter(row=>!row.passed),[]);
}
async function snapshot(db) {
  return (await db.query(`select jsonb_build_object(
    'columns',(select jsonb_agg(row_to_json(c)) from information_schema.columns c where table_schema='public' and table_name='EventInteractionLog'),
    'policies',(select jsonb_agg(row_to_json(p)) from pg_policies p where schemaname='public' and tablename='EventInteractionLog'),
    'constraints',(select jsonb_agg(jsonb_build_array(conname,pg_get_constraintdef(oid)) order by conname) from pg_constraint where conrelid='public."EventInteractionLog"'::regclass),
    'rows',(select jsonb_agg(row_to_json(l) order by "InteractionID") from public."EventInteractionLog" l)
  ) as snapshot`)).rows[0].snapshot;
}

test('production repair supports fresh install and repeat runs without changing user/history/score data',async()=>{
  const {db,repair,send,inbox,asUser}=await sharingDatabase({migrate:false});
  try {
    // Sentinel score objects prove the repair never rewrites existing score objects.
    await db.exec(`create table public."MonthlyOKRScores"(marker text); insert into public."MonthlyOKRScores" values ('monthly');
      create table public."OverallOKRScores"(marker text); insert into public."OverallOKRScores" values ('overall');
      create function public."CalculateMonthlyOKRs"() returns text language sql as $$ select 'unchanged monthly'::text $$;
      create function public."CalculateOverallOKRs"() returns text language sql as $$ select 'unchanged overall'::text $$;`);
    const scoreDefs=(await db.query(`select pg_get_functiondef(oid) as definition from pg_proc where proname in ('CalculateMonthlyOKRs','CalculateOverallOKRs') order by proname`)).rows;
    const users=(await db.query('select * from public."User" order by "UserID"')).rows;
    const views=(await db.query(`select * from public."EventInteractionLog" where "InteractionType"='view'`)).rows;
    await db.exec(repair);await verified(db);
    const external=await send(A,'9223372036854775807','copy_link',null,key(401));
    const direct=await send(A,'9007199254740993','in_app',B,key(402));
    const before=await snapshot(db);
    await db.exec(repair);await verified(db);
    assert.deepEqual(await snapshot(db),before);
    assert.deepEqual(await send(A,'9223372036854775807','copy_link',null,key(401)),external);
    assert((await inbox(B)).some(row=>row.interaction_id===direct[0].interaction_id));
    assert.deepEqual((await db.query('select * from public."User" order by "UserID"')).rows,users);
    const currentView=(await db.query(`select "InteractionID","UserID","EventID","InteractionType","RecipientUserID",created_at from public."EventInteractionLog" where "InteractionType"='view'`)).rows;
    assert.deepEqual(currentView,views);
    assert.deepEqual((await db.query(`select pg_get_functiondef(oid) as definition from pg_proc where proname in ('CalculateMonthlyOKRs','CalculateOverallOKRs') order by proname`)).rows,scoreDefs);
    assert.deepEqual((await db.query('select * from public."MonthlyOKRScores"')).rows,[{marker:'monthly'}]);
    assert.deepEqual((await db.query('select * from public."OverallOKRScores"')).rows,[{marker:'overall'}]);
    await asUser(A,`insert into public."EventInteractionLog" ("UserID","EventID","InteractionType","RecipientUserID") values ($1,1,'view',null)`,[A]);
  } finally {await db.close();}
});

test('production repair replaces mismatched argument names, return types, and conflicting overloads',async()=>{
  const {db,repair,send}=await sharingDatabase({migrate:false});
  try {
    await db.exec(`create function public.gather_share_event(event_id bigint,channel text,recipient uuid,request uuid) returns bigint language sql as $$ select 99::bigint $$;
      create function public.gather_share_event(event_id text,channel text,recipient uuid,request uuid) returns text language sql as $$ select 'obsolete'::text $$;
      create function public.gather_received_event_shares(cursor_id bigint,page_size integer) returns jsonb language sql as $$ select '{}'::jsonb $$;`);
    await db.exec(repair);await verified(db);
    assert.equal(typeof (await send(A,'1','copy_link',null,key(410)))[0].interaction_id,'string');
  } finally {await db.close();}
});

test('known legacy CHECK shapes are recognized by parsed definitions, without guessing names',async t=>{
  for(const [name,expr] of Object.entries({
    reverse:`("InteractionType"='share' and "RecipientUserID" is not null) or ("InteractionType"='view' and "RecipientUserID" is null)`,
    implication:`"InteractionType"<>'share' or "RecipientUserID" is not null`,
    view_or:`"InteractionType"='view' or "RecipientUserID" is not null`,
    equivalence:`("InteractionType"='share')=("RecipientUserID" is not null)`,
    case_check:`case when "InteractionType"='share' then "RecipientUserID" is not null else "RecipientUserID" is null end`,
    nonshare_null:`("InteractionType"='share' and "RecipientUserID" is not null) or ("InteractionType"<>'share' and "RecipientUserID" is null)`,
    distinct_recipient:`("InteractionType"='view' and "RecipientUserID" is null) or ("InteractionType"='share' and "RecipientUserID" is not null and "RecipientUserID"<>"UserID")`,
  })) await t.test(name,async()=>{
    const {db,repair,send}=await sharingDatabase({migrate:false});
    try {
      await db.exec(`alter table public."EventInteractionLog" drop constraint fixture_recipient_check,add constraint arbitrary_legacy_name check (${expr})`);
      await db.exec(repair);await verified(db);
      await send(A,'1','native',null,key(420));await send(A,'1','in_app',B,key(421));
    } finally {await db.close();}
  });
});

test('partial sharing installation and prior Phase 2 migration are repairable',async()=>{
  for(const partial of [true,false]) {
    const {db,repair,migration}=await sharingDatabase({migrate:false});
    try {
      if(partial) await db.exec('alter table public."EventInteractionLog" add column "ShareChannel" text;');
      else await db.exec(migration.replace("legacy_constraint text := 'REVIEW_REQUIRED_RECIPIENT_CHECK_NAME'","legacy_constraint text := 'fixture_recipient_check'"));
      await db.exec(repair);await verified(db);
    } finally {await db.close();}
  }
});

test('unsupported schema, policies, inherited grants, indexes and function dependencies fail atomically',async t=>{
  const cases=[
    ['column type',`alter table public."EventInteractionLog" add column "ShareChannel" integer;`,/ShareChannel must be nullable text/],
    ['unknown check',`alter table public."EventInteractionLog" add constraint custom_check check ("InteractionType"='view' or "RecipientUserID" is not null or "UserID" is not null);`,/Unsupported interaction CHECK custom_check/],
    ['history policy',`create policy expose_history on public."EventInteractionLog" for select to authenticated using (true);`,/privacy review/],
    ['restrictive policy',`create policy deny_views on public."EventInteractionLog" as restrictive for insert to authenticated with check (false);`,/restrictive INSERT policy/],
    ['inherited grants',`create role broad_writer; grant broad_writer to authenticated; grant insert on public."EventInteractionLog" to broad_writer;`,/Inherited INSERT grants/],
    ['wrong index',`create index gather_share_request_unique on public."EventInteractionLog" ("UserID");`,/incompatible definition/],
    ['dependent function',`create function public.gather_share_event(bigint,text,uuid,uuid) returns text language sql as $$ select 'old'::text $$;
      create view public.fixture_dependency as select public.gather_share_event(1::bigint,'native'::text,null::uuid,null::uuid);`,/other objects depend/],
  ];
  for(const [label,setup,pattern] of cases)await t.test(label,async()=>{
    const {db,repair}=await sharingDatabase({migrate:false});
    try {
      await db.exec(setup);const before=await snapshot(db);
      await assert.rejects(db.exec(repair),pattern);await db.exec('rollback');
      assert.deepEqual(await snapshot(db),before);
    } finally {await db.close();}
  });
});


test('repair does not weaken existing event-existence checks, even if the log has no event FK',async()=>{
  const {db,asUser}=await sharingDatabase();
  try {
    await db.exec('alter table public."EventInteractionLog" drop constraint "EventInteractionLog_EventID_fkey";');
    await assert.rejects(asUser(A,`insert into public."EventInteractionLog" ("UserID","EventID","InteractionType","RecipientUserID") values ($1,999,'view',null)`,[A]),error=>error.code==='42501');
  } finally {await db.close();}
});
