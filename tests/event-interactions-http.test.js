import test from 'node:test';
import assert from 'node:assert/strict';
import * as modules from 'node:module';
import {database, USER_A, USER_B} from './helpers/database.js';

test('view API verifies sessions and account, validates IDs and writes only the verified viewer',
  {skip: !modules.registerHooks && 'Node 22.15+ required'}, async () => {
  Object.assign(process.env, {NODE_ENV:'test', SUPABASE_URL:'https://fixture.invalid', SUPABASE_KEY:'test-key'});
  const db = database();
  db.rows.Events.push({EventID:'9007199254740993'}, {EventID:'9223372036854775807'});
  let verified = true;
  globalThis.__viewClient = () => ({...db.client, auth: {
    async setSession({access_token}) {return access_token === 'valid'
      ? {data:{session:{access_token:'valid',refresh_token:'refresh',user:{id:USER_B}}}}
      : {error:{status:401}};},
    async getUser() {return {data:{user:verified ? {id:USER_A} : null}};},
  }});
  const hooks = modules.registerHooks({resolve(specifier, context, next) {
    if (specifier === '@supabase/supabase-js') return {url:'data:text/javascript,export const createClient=()=>globalThis.__viewClient();',shortCircuit:true};
    return next(specifier,context);
  }});
  const {server} = await import('../server.js');
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (id='1', {cookie='gather_access=valid; gather_refresh=refresh', actor=USER_A, body={}, method='POST', headers={}}={}) =>
    fetch(`${base}/api/events/${id}/view`, {method, headers:{Cookie:cookie,'X-Gather-Account':actor,'Content-Type':'application/json',...headers},
      ...(method==='GET'?{}:{body:JSON.stringify(body)})});
  try {
    assert.equal((await call('1',{cookie:''})).status,401);
    assert.equal((await call('1',{cookie:'gather_access=forged; gather_refresh=refresh'})).status,401);
    verified=false; assert.equal((await call()).status,401); verified=true;
    assert.equal((await call('1',{actor:USER_B})).status,409);
    assert.equal((await call('1',{actor:''})).status,409);
    assert.equal((await call('1',{headers:{Origin:'https://attacker.invalid'}})).status,403);
    assert.equal((await call('1',{method:'GET'})).status,405);
    for (const id of ['0','-1','01','1.5','abc','9223372036854775808']) assert.equal((await call(id)).status,400);
    for (const body of [null,[],{UserID:USER_B},{EventID:'2'},{InteractionType:'share'},{created_at:'forged'}])
      assert.equal((await call('1',{body})).status,400);
    assert.equal((await call('999')).status,404);
    assert.equal(db.rows.EventInteractionLog.length,0);
    for (const id of ['1','9007199254740993','9223372036854775807']) {
      const response=await call(id); assert.equal(response.status,201);
      assert.deepEqual(await response.json(),{logged:true});
      assert.deepEqual(db.rows.EventInteractionLog.at(-1),{UserID:USER_A,EventID:id,InteractionType:'view',RecipientUserID:null});
    }
    await call('1'); assert.equal(db.rows.EventInteractionLog.length,4); // reopening is another view
    assert(db.calls.filter(c=>c.table==='Events').every(c=>c.projection==='EventID::text'));
    assert(db.calls.filter(c=>c.table==='EventInteractionLog').every(c=>c.projection===undefined));
    db.errors.set('EventInteractionLog',{code:'42501',message:'private database details'});
    const failed=await call(); assert.equal(failed.status,500);
    assert(!(await failed.text()).includes('private database'));
    assert.equal(db.rows.EventInteractionLog.length,4);
    assert.equal((await fetch(base+'/api/health')).status,200);
  } finally {
    await new Promise(resolve=>server.close(resolve)); hooks.deregister(); delete globalThis.__viewClient;
  }
});
