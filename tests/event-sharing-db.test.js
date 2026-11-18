import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sharingDatabase,A,B,C,key} from './helpers/sharing-database.js';

test('isolated PostgreSQL migration, share RPC, grants and recipient isolation',async t=>{
  const {db,asUser,send,inbox}=await sharingDatabase();
  try {
    // Exercise generated interaction IDs beyond JavaScript's exact numeric range.
    await db.query("select setval(pg_get_serial_sequence('public.\"EventInteractionLog\"','InteractionID'),9007199254740992)");
    await t.test('migration preserves old rows and the view policy; views still insert',async()=>{
      const rows=(await db.query('select * from public."EventInteractionLog" order by "InteractionID"')).rows;
      assert.equal(rows.length,2);assert.equal(rows[0].ShareChannel,null);assert.equal(rows[1].ShareChannel,'in_app');
      const policies=(await db.query("select policyname from pg_policies where tablename='EventInteractionLog'")).rows;
      assert(policies.some(p=>p.policyname==='gather_event_view_insert'));
      await asUser(A,`insert into public."EventInteractionLog" ("UserID","EventID","InteractionType","RecipientUserID") values ($1,1,'view',null)`,[A]);
      assert.equal((await db.query('select count(*)::int as count from public."EventInteractionLog"')).rows[0].count,3);
    });
    await t.test('external native and copy shares count as share with no recipient and exact IDs',async()=>{
      for(const [n,channel] of [[1,'native'],[2,'copy_link']]) {
        const sent=await send(A,'9223372036854775807',channel,null,key(n));
        assert.equal(typeof sent[0].interaction_id,'string');
        const row=(await db.query('select * from public."EventInteractionLog" where "ShareRequestID"=$1',[key(n)])).rows[0];
        assert.equal(row.InteractionType,'share');assert.equal(row.RecipientUserID,null);assert.equal(row.ShareChannel,channel);
        assert.equal(String(row.EventID),'9223372036854775807');
      }
    });
    await t.test('accepted friends receive one atomic analytics/delivery row; retry is idempotent',async()=>{
      const one=await send(A,'9007199254740993','in_app',B,key(3));
      const two=await send(A,'9007199254740993','in_app',B,key(3));assert.deepEqual(one,two);
      assert.equal((await db.query('select count(*)::int as count from public."EventInteractionLog" where "ShareRequestID"=$1',[key(3)])).rows[0].count,1);
      const rows=await inbox(B);assert.equal(rows[0].event_id,'9007199254740993');assert.equal(rows[0].sender_name,'Alex Sender');
      assert.equal(rows.filter(row=>row.interaction_id===one[0].interaction_id).length,1);
      assert.deepEqual(await inbox(C),[]);assert.deepEqual(await inbox(A),[]);
      const reverse=await send(B,'1','in_app',A,key(4));
      assert.equal((await inbox(A))[0].interaction_id,reverse[0].interaction_id);
      assert.equal((await inbox(A))[0].sender_name,'@blair');
      assert(!JSON.stringify(await inbox(A)).includes('PRIVATE NAME'));
      const first=await inbox(B,null,1),next=await inbox(B,first[0].interaction_id,1);
      assert.equal(first.length,1);assert.equal(next.length,1);assert.notEqual(first[0].interaction_id,next[0].interaction_id);
    });
    await t.test('nonfriends, missing users/events, self, malformed channels and idempotency conflicts fail without rows',async()=>{
      const before=(await db.query('select count(*)::int as count from public."EventInteractionLog"')).rows[0].count;
      for(const [id,channel,recipient,n,code] of [
        ['1','in_app',C,10,'42501'],['999','in_app',B,11,'23503'],['1','in_app',A,12,'22023'],
        ['1','native',B,13,'22023'],['1','bad',null,14,'22023'],['0','native',null,15,'22023'],
        ['1','in_app','44444444-4444-4444-8444-444444444444',16,'23503'],['1','native',null,3,'23505']])
        await assert.rejects(send(A,id,channel,recipient,key(n)),e=>e.code===code);
      assert.equal((await db.query('select count(*)::int as count from public."EventInteractionLog"')).rows[0].count,before);
    });
    await t.test('no direct shares, generated-field overrides, forged viewers, anonymous RPCs or raw history reads',async()=>{
      for(const actor of [A,B,C]) await assert.rejects(asUser(actor,'select * from public."EventInteractionLog"'),e=>e.code==='42501');
      await assert.rejects(send(null,'1','native',null,key(20)),e=>e.code==='42501');
      await assert.rejects(inbox(null),e=>e.code==='42501');
      await assert.rejects(asUser(A,`insert into public."EventInteractionLog" ("UserID","EventID","InteractionType","RecipientUserID") values ($1,1,'view',null)`,[B]),e=>e.code==='42501');
      await assert.rejects(asUser(A,`insert into public."EventInteractionLog" ("UserID","EventID","InteractionType","RecipientUserID") values ($1,1,'share',$2)`,[A,B]),e=>e.code==='42501');
      await assert.rejects(asUser(A,`insert into public."EventInteractionLog" ("UserID","EventID","InteractionType",created_at) values ($1,1,'view',now())`,[A]),e=>e.code==='42501');
      await assert.rejects(inbox(B,null,52),e=>e.code==='22023');
    });
    await t.test('an after-insert failure rolls back analytics and delivery together',async()=>{
      const before=(await db.query('select count(*)::int as count from public."EventInteractionLog"')).rows[0].count;
      await db.exec(`create function public.fixture_reject_share() returns trigger language plpgsql as $$
        begin if new."ShareRequestID"='${key(98)}'::uuid then raise exception 'fixture rejects after insert'; end if; return new; end $$;
        create trigger fixture_reject_share after insert on public."EventInteractionLog" for each row execute function public.fixture_reject_share();`);
      await assert.rejects(send(A,'1','in_app',B,key(98)),/fixture rejects/);
      assert.equal((await db.query('select count(*)::int as count from public."EventInteractionLog"')).rows[0].count,before);
      await db.exec('drop trigger fixture_reject_share on public."EventInteractionLog"; drop function public.fixture_reject_share();');
    });
    await t.test('friend removal prevents new sends; previously delivered shares and retry receipts remain accessible',async()=>{
      const before=await inbox(B);
      await asUser(A,'select public.remove_friend($1::uuid)',[B]);
      await assert.rejects(send(A,'1','in_app',B,key(30)),e=>e.code==='42501');
      assert.deepEqual(await inbox(B),before);
      assert.equal((await send(A,'9007199254740993','in_app',B,key(3)))[0].interaction_id,before[0].interaction_id);
    });
    await t.test('OKR count predicate includes all three share channels and excludes views',async()=>{
      const rows=(await db.query(`select "ShareChannel",count(*)::int as count from public."EventInteractionLog" where "InteractionType"='share' group by "ShareChannel"`)).rows;
      assert.deepEqual(Object.fromEntries(rows.map(row=>[row.ShareChannel,row.count])),{native:1,copy_link:1,in_app:3});
    });
  } finally {await db.close();}
});

test('unconfigured migration fails closed without altering legacy data',async()=>{
  const {db,migration}=await sharingDatabase({migrate:false});
  try {
    await assert.rejects(db.exec(migration),/explicitly name/);await db.exec('rollback');
    assert.equal((await db.query('select count(*)::int as count from public."EventInteractionLog"')).rows[0].count,2);
    assert.equal((await db.query("select count(*)::int as count from information_schema.columns where table_name='EventInteractionLog' and column_name='ShareChannel'")).rows[0].count,0);
  } finally {await db.close();}
});


test('the complete local/staging SQL rehearsal passes and rolls back all new logs',async()=>{
  const {db}=await sharingDatabase();
  try {
    const before=(await db.query('select count(*)::int as count from public."EventInteractionLog"')).rows[0].count;
    await db.exec(await readFile(new URL('../supabase/tests/event_sharing_checks.sql',import.meta.url),'utf8'));
    const after=(await db.query('select count(*)::int as count from public."EventInteractionLog"')).rows[0].count;
    assert.equal(after,before);
  } finally {await db.close();}
});

test('missing sharing database functions block both channels; installing reviewed SQL enables both and preserves views',async()=>{
  const {db,send,inbox,migration}=await sharingDatabase({migrate:false});
  const diagnostics=await readFile(new URL('../supabase/review/event_sharing_diagnostics.sql',import.meta.url),'utf8');
  try {
    const before=JSON.parse((await db.query(diagnostics)).rows[0].sharing_diagnostics);
    assert.deepEqual(before.sharing_functions,[]);
    assert.equal(before.interaction_columns.some(column=>column.name==='ShareChannel'),false);
    const beforeCount=(await db.query('select count(*)::int as count from public."EventInteractionLog"')).rows[0].count;
    await assert.rejects(send(A,'1','copy_link',null,key(301)),error=>error.code==='42883');
    await assert.rejects(send(A,'1','in_app',B,key(302)),error=>error.code==='42883');
    assert.equal((await db.query('select count(*)::int as count from public."EventInteractionLog"')).rows[0].count,beforeCount);
    await db.exec(migration.replace("legacy_constraint text := 'REVIEW_REQUIRED_RECIPIENT_CHECK_NAME'", "legacy_constraint text := 'fixture_recipient_check'"));
    const after=JSON.parse((await db.query(diagnostics)).rows[0].sharing_diagnostics);
    assert.equal(after.sharing_functions.length,2);
    assert(after.sharing_functions.every(fn=>fn.authenticated_can_execute&&!fn.anon_can_execute));
    await send(A,'1','copy_link',null,key(301));
    const direct=await send(A,'1','in_app',B,key(302));
    const counts=(await db.query(`select "ShareChannel",count(*)::int as count from public."EventInteractionLog" where "ShareRequestID" in ($1,$2) and "InteractionType"='share' group by "ShareChannel"`,[key(301),key(302)])).rows;
    assert.deepEqual(Object.fromEntries(counts.map(row=>[row.ShareChannel,row.count])),{copy_link:1,in_app:1});
    assert((await inbox(B)).some(row=>row.interaction_id===direct[0].interaction_id));
    assert.equal((await db.query(`select count(*)::int as count from public."EventInteractionLog" where "InteractionType"='view'`)).rows[0].count,1);
  } finally {await db.close();}
});
