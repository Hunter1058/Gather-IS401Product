import test from 'node:test';
import assert from 'node:assert/strict';
import { passwordRecovery } from '../lib/password-recovery.js';

function fixture(options={}) {
  let time=1000000, linkError=null, updateError=null, revokeError=null, hold=null, ledgerError=null;
  const calls=[],tickets=new Map(),usedLinks=new Set();
  const users={a:{id:'account-a',email:'a@example.com'},b:{id:'account-b',email:'b@example.com'}};
  const makeClient=()=>{
    let actor;
    return {auth:{
      async resetPasswordForEmail(email,config){calls.push(['email',email,config]);return {error:linkError};},
      async resend(input){calls.push(['resend',input]);return {error:linkError};},
      async verifyOtp(input){
        calls.push(['verify',input]);
        if(usedLinks.has(input.token_hash) || input.token_hash.startsWith('invalid')) return {error:{status:403,message:'SECRET'}};
        usedLinks.add(input.token_hash);actor=input.token_hash.endsWith('b')?'b':'a';
        return {data:{user:users[actor],session:{access_token:'private-access-'+actor,refresh_token:'private-refresh-'+actor}}};
      },
      async setSession(input){actor=input.access_token.endsWith('b')?'b':'a';return {data:{session:{access_token:input.access_token,refresh_token:input.refresh_token}}};},
      async getUser(){return {data:{user:users[actor]}};},
      async updateUser(input){calls.push(['update',actor,input]);if(hold)await hold;if(updateError instanceof Error)throw updateError;return {error:updateError};},
      async signOut(input){calls.push(['signout',actor,input]);return {error:revokeError};},
    },async rpc(name,{p_hash,p_action}){
      assert.equal(name,'gather_recovery_ticket');if(ledgerError)return {error:ledgerError};
      const row=tickets.get(actor);let data=false;
      if(p_action==='issue'){tickets.set(actor,{hash:p_hash,consumed:false});data=true;}
      else if(row?.hash===p_hash){
        if(p_action==='check')data=!row.consumed;
        else if(p_action==='consume'&&!row.consumed){row.consumed=true;data=true;}
        else if(p_action==='release'&&row.consumed){row.consumed=false;data=true;}
      }
      return {data};
    }};
  };
  const recovery=passwordRecovery({makeClient,sessionCookies:{clear(res){res.setHeader('Set-Cookie',['gather_access=; Max-Age=0','gather_refresh=; Max-Age=0']);}},
    secure:true,env:{AUTH_RECOVERY_SECRET:'test-secret-only-'.repeat(4),APP_ORIGIN:'https://gather.example',...options.env},limit(){},now:()=>time});
  async function call(path,input,cookie='',method='POST') {
    const res={headers:{},setHeader(k,v){this.headers[k]=v;},getHeader(k){return this.headers[k];}};
    const req={method,headers:{cookie,host:'attacker.example'}};
    const json=(_res,status,data)=>Object.assign(res,{status,data});
    try {await recovery.handle('/auth/'+path,req,res,async()=>input,json);}catch(error){res.status=error.status||500;res.data={error:error.status?error.message:'Request failed'};}
    res.cookie=(Array.isArray(res.headers['Set-Cookie'])?res.headers['Set-Cookie'].find(c=>c.startsWith('gather_recovery=')):res.headers['Set-Cookie'])?.split(';')[0];
    return res;
  }
  const verify=(suffix='a')=>call('recovery/verify',{tokenHash:'valid-link-12345678901234567890-'+suffix});
  return {call,verify,calls,tickets,advance(ms){time+=ms;},linkError(e){linkError=e;},updateError(e){updateError=e;},revokeError(e){revokeError=e;},ledgerError(e){ledgerError=e;},hold(p){hold=p;}};
}
const password={password:'a new strong password',confirmPassword:'a new strong password'};

test('reset and resend give generic eligibility responses and use fixed allowlisted destinations',async()=>{
  const f=fixture();
  const known=await f.call('forgot-password',{email:' A@EXAMPLE.COM '});
  f.linkError({status:400,message:'Email not found SECRET'});
  const unknown=await f.call('forgot-password',{email:'missing@example.com'});
  assert.deepEqual(known.data,unknown.data);assert.equal(unknown.status,200);
  assert.deepEqual(f.calls[0],['email','a@example.com',{redirectTo:'https://gather.example/recover'}]);
  await f.call('resend-confirmation',{email:'a@example.com'});
  assert.equal(f.calls.at(-1)[1].options.emailRedirectTo,'https://gather.example/login');
  f.linkError({status:503,message:'SECRET'});assert.equal((await f.call('forgot-password',{email:'a@example.com'})).status,503);
  f.linkError({status:429});assert.equal((await f.call('forgot-password',{email:'a@example.com'})).status,429);
});
test('missing deployment secret disables recovery without contacting Auth',async()=>{
  const f=fixture({env:{AUTH_RECOVERY_SECRET:''}});
  assert.equal((await f.call('forgot-password',{email:'a@example.com'})).status,503);assert.equal(f.calls.length,0);
});
test('recovery verification fixes token type and stores encrypted HttpOnly credentials outside normal login',async()=>{
  const f=fixture(),res=await f.verify();assert.equal(res.status,200);
  assert.deepEqual(f.calls[0][1],{token_hash:'valid-link-12345678901234567890-a',type:'recovery'});
  assert.match(res.headers['Set-Cookie'],/HttpOnly; SameSite=Strict; Path=\/api\/auth\/recovery; Max-Age=900; Secure/);
  assert(!JSON.stringify(res).includes('private-access'));assert(!res.cookie.includes('gather_access='));
  assert.equal((await f.call('recovery/status',null,res.cookie,'GET')).data.email,'a@example.com');
});
test('normal account B cookies cannot authorize recovery; account A link changes only A',async()=>{
  const f=fixture();assert.equal((await f.call('recovery/password',password,'gather_access=account-b; gather_refresh=b')).status,401);
  const verified=await f.verify();
  const result=await f.call('recovery/password',password,verified.cookie+'; gather_access=account-b; gather_refresh=b');
  assert.equal(result.status,200);assert.deepEqual(f.calls.find(c=>c[0]==='update'),['update','a',{password:password.password}]);
  assert.deepEqual(f.calls.find(c=>c[0]==='signout'),['signout','a',{scope:'global'}]);
  assert(result.headers['Set-Cookie'].some(c=>c.startsWith('gather_access=;')));
});
test('tampered, duplicate, expired cookies and replayed email links fail closed',async()=>{
  const f=fixture(),res=await f.verify();
  for(const cookie of [res.cookie+'x',res.cookie+'; '+res.cookie,'gather_recovery=%ZZ'])
    assert.equal((await f.call('recovery/password',password,cookie)).status,401);
  assert.equal((await f.verify()).status,400);
  f.advance(900001);assert.equal((await f.call('recovery/status',null,res.cookie,'GET')).status,401);
  assert(!f.calls.some(c=>c[0]==='update'));
});
test('a newer recovery supersedes the previous ticket and a failed link clears the browser ticket',async()=>{
  const f=fixture(),old=await f.verify();
  const newer=await f.call('recovery/verify',{tokenHash:'different-valid-12345678901234567890-a'});
  assert.equal((await f.call('recovery/status',null,old.cookie,'GET')).status,401);
  assert.equal((await f.call('recovery/status',null,newer.cookie,'GET')).status,200);
  const bad=await f.call('recovery/verify',{tokenHash:'invalid-link-12345678901234567890'});
  assert.equal(bad.status,400);assert.match(bad.headers['Set-Cookie'],/Max-Age=0/);
});
test('password validation rejects mismatches and owner injection without consuming recovery',async()=>{
  const f=fixture(),verified=await f.verify();
  for(const value of [null,[],{...password,UserID:'b'},{...password,confirmPassword:'different'},{password:'short',confirmPassword:'short'}])
    assert.equal((await f.call('recovery/password',value,verified.cookie)).status,400);
  assert.equal((await f.call('recovery/password',password,verified.cookie)).status,200);
});
test('atomic ticket consumption prevents concurrent and subsequent password changes',async()=>{
  const f=fixture(),verified=await f.verify();let release;f.hold(new Promise(r=>release=r));
  const pending=f.call('recovery/password',password,verified.cookie);
  await new Promise(r=>setImmediate(r));
  const racing=await f.call('recovery/password',password,verified.cookie);assert([401,409].includes(racing.status));
  release();assert.equal((await pending).status,200);
  assert.equal((await f.call('recovery/password',password,verified.cookie)).status,401);
  assert.equal(f.calls.filter(c=>c[0]==='update').length,1);
});
test('explicit weak-password rejections allow retry, ambiguous outages keep tickets consumed',async()=>{
  const f=fixture(),verified=await f.verify();f.updateError({status:422,code:'weak_password'});
  assert.equal((await f.call('recovery/password',password,verified.cookie)).status,400);
  f.updateError(null);assert.equal((await f.call('recovery/password',password,verified.cookie)).status,200);
  const g=fixture(),v=await g.verify();g.updateError({status:503});
  assert.equal((await g.call('recovery/password',password,v.cookie)).status,503);
  g.updateError(null);assert.equal((await g.call('recovery/password',password,v.cookie)).status,401);
});
test('ledger failures never allow password changes and signout outages are reported truthfully',async()=>{
  const f=fixture(),v=await f.verify();f.ledgerError({status:503});
  assert.equal((await f.call('recovery/password',password,v.cookie)).status,503);assert(!f.calls.some(c=>c[0]==='update'));
  f.ledgerError(null);f.revokeError({status:503});
  assert.deepEqual((await f.call('recovery/password',password,v.cookie)).data,{ok:true,sessionsRevoked:false});
});
