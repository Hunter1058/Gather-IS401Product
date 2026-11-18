import test from 'node:test';
import assert from 'node:assert/strict';
import * as modules from 'node:module';
import {sharingDatabase,A,B,C,key} from './helpers/sharing-database.js';

test('share/inbox HTTP APIs use verified JWT actors and real isolated PostgreSQL permissions',
  {skip:!modules.registerHooks && 'Node 22.15+ required'},async t=>{
  const diagnostics=[];
  t.mock.method(console,'error',(...args)=>diagnostics.push(args));
  let upstreamError=null;
  const store=await sharingDatabase();
  await store.db.query("select setval(pg_get_serial_sequence('public.\"EventInteractionLog\"','InteractionID'),9007199254740992)");
  Object.assign(process.env,{NODE_ENV:'test',SUPABASE_URL:'https://fixture.invalid',SUPABASE_KEY:'test-publishable'});
  globalThis.__shareClient=()=>{
    let actor=null;
    return {auth:{
      async setSession({access_token,refresh_token}) {
        actor=[A,B,C].includes(access_token)&&refresh_token==='refresh'?access_token:null;
        return actor?{data:{session:{access_token,refresh_token,user:{id:C}}}}:{error:{status:401}};
      },
      async getUser(){return {data:{user:actor?{id:actor}:null}};},
    },async rpc(name,args) {
      if (upstreamError) return {error:upstreamError};
      try {const data=name==='gather_share_event'
        ? await store.send(actor,args.p_event_id,args.p_channel,args.p_recipient,args.p_request_id)
        : await store.inbox(actor,args.p_after,args.p_limit);
        return {data:JSON.parse(JSON.stringify(data))};}
      catch(error){return {error};}
    }};
  };
  const hooks=modules.registerHooks({resolve(specifier,context,next){
    if(specifier==='@supabase/supabase-js')return {url:'data:text/javascript,export const createClient=()=>globalThis.__shareClient();',shortCircuit:true};
    return next(specifier,context);
  }});
  const {server}=await import('../server.js');
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const call=(path,{actor=A,account=actor,method='POST',body={},headers={}}={})=>fetch(base+'/api'+path,{
    method,headers:{'Content-Type':'application/json',...(actor?{Cookie:`gather_access=${actor}; gather_refresh=refresh`}:{}),
      ...(account?{'X-Gather-Account':account}:{}),...headers},...(method==='GET'?{}:{body:JSON.stringify(body)})});
  const payload={channel:'in_app',recipientId:B,requestId:key(101)};
  try {
    assert.equal((await call('/events/1/share',{actor:null})).status,401);
    assert.equal((await call('/events/1/share',{account:B,body:payload})).status,409);
    assert.equal((await call('/events/1/share',{account:null,body:payload})).status,409);
    assert.equal((await call('/events/1/share',{headers:{Origin:'https://attacker.invalid'},body:payload})).status,403);
    for(const body of [null,[],{...payload,UserID:C},{...payload,created_at:'forged'},{...payload,recipientId:'bad'},
      {...payload,requestId:3},{channel:'native',requestId:key(2),recipientId:B},{...payload,channel:'invalid'}])
      assert.equal((await call('/events/1/share',{body})).status,400);
    for(const id of ['0','01','-1','1.1','abc','9223372036854775808'])assert.equal((await call(`/events/${id}/share`,{body:payload})).status,400);
    assert.equal((await call('/events/999/share',{body:payload})).status,404);
    assert.equal((await call('/events/1/share',{body:{...payload,recipientId:C}})).status,403);
    const first=await call('/events/9007199254740993/share',{body:payload});assert.equal(first.status,200);
    const sent=await first.json();assert.equal(sent.accountId,A);assert.equal(typeof sent.interactionId,'string');assert(BigInt(sent.interactionId)>9007199254740991n);
    const again=await (await call('/events/9007199254740993/share',{body:payload})).json();assert.equal(again.interactionId,sent.interactionId);
    const row=(await store.db.query('select "UserID" from public."EventInteractionLog" where "ShareRequestID"=$1',[key(101)])).rows[0];assert.equal(row.UserID,A);
    const received=await call('/shared-events',{actor:B,method:'GET'});assert.equal(received.status,200);
    assert((await received.json()).shares.some(s=>s.id===sent.interactionId&&s.eventId==='9007199254740993'));
    assert.deepEqual((await (await call('/shared-events',{actor:C,method:'GET'})).json()).shares,[]);
    const firstPage=await (await call('/shared-events?limit=1',{actor:B,method:'GET'})).json();
    assert.equal(firstPage.nextCursor,sent.interactionId);
    const nextPage=await (await call('/shared-events?limit=1&after='+firstPage.nextCursor,{actor:B,method:'GET'})).json();
    assert.equal(nextPage.shares.length,1);assert.notEqual(nextPage.shares[0].id,sent.interactionId);

    assert.equal((await call('/shared-events',{actor:null,method:'GET'})).status,401);
    assert.equal((await call('/shared-events',{actor:B,method:'GET',headers:{Origin:'https://attacker.invalid'}})).status,403);
    assert.equal((await call('/shared-events',{actor:B,account:A,method:'GET'})).status,409);
    for(const suffix of ['?recipientId='+B,'?limit=51','?after=9223372036854775808','?limit=1&limit=2'])
      assert.equal((await call('/shared-events'+suffix,{actor:B,method:'GET'})).status,400);
    assert.equal((await call('/events/1/share',{method:'GET'})).status,405);
    assert.equal((await call('/shared-events')).status,405);
    for(const [n,channel] of [[102,'native'],[103,'copy_link']])
      assert.equal((await call('/events/9223372036854775807/share',{body:{channel,requestId:key(n)}})).status,200);
    for(const databaseCode of ['PGRST202','PGRST204','PGRST205','42883','42P01','42703','23514']) {
      upstreamError={code:databaseCode,message:'PRIVATE database constraint for user@example.test',details:'PRIVATE row data'};
      const response=await call('/events/1/share',{body:{channel:'copy_link',requestId:key(200)}});
      assert.equal(response.status,503);
      const result=await response.json();
      assert.equal(result.code,databaseCode==='23514'?'SHARING_UNAVAILABLE':'SHARING_SETUP_REQUIRED');
      assert(!JSON.stringify(result).includes('PRIVATE'));
      assert(diagnostics.at(-1).includes(databaseCode));
      assert(!JSON.stringify(diagnostics.at(-1)).includes('PRIVATE'));
    }
  } finally {
    await new Promise(resolve=>server.close(resolve));hooks.deregister();delete globalThis.__shareClient;await store.db.close();
  }
});
