import test from 'node:test';
import assert from 'node:assert/strict';
import * as modules from 'node:module';

test('real account routes validate inputs, isolate recovery, protect origins and hide provider internals',
  {skip:!modules.registerHooks && 'Node 22.15+ required'},async t=>{
  Object.assign(process.env,{NODE_ENV:'test',SUPABASE_URL:'https://fixture.invalid',SUPABASE_KEY:'publishable-test',
    AUTH_RECOVERY_SECRET:'test-only-server-secret-'.repeat(3),APP_ORIGIN:'https://gather.example'});
  const calls=[];let providerError=null;
  globalThis.__authHttpClient=()=>({
  rpc: async () => ({data:true,error:null}),
  auth:{
    async signInWithPassword(input){calls.push(['login',input]);return providerError?{error:providerError}:{data:{user:{id:'a',email:input.email},session:{access_token:'SECRET-access',refresh_token:'SECRET-refresh'}}};},
    async signUp(input){calls.push(['signup',input]);return {data:{user:{id:'new'},session:null},error:providerError};},
    async resetPasswordForEmail(...input){calls.push(['reset',...input]);return {error:providerError};},
    async resend(input){calls.push(['resend',input]);return {error:providerError};},
  }});
  const hooks=modules.registerHooks({resolve(specifier,context,next){
    if(specifier==='@supabase/supabase-js')return {url:'data:text/javascript,export const createClient=()=>globalThis.__authHttpClient();',shortCircuit:true};
    return next(specifier,context);
  }});
  const {server}=await import('../server.js');
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(path,data,headers={})=>fetch(base+'/api/auth/'+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://gather.example',...headers},body:JSON.stringify(data)});
  try {
    await t.test('null, arrays, wrong types and forged identity are client errors',async()=>{
      for(const input of [null,[],{email:42,password:'12345678'},{email:'a@b.co',password:42},{email:'a@b.co',password:'12345678',UserID:'victim'}])
        assert.equal((await post('login',input)).status,400);
      assert.equal((await post('signup',{email:'a@b.co',password:'12345678',name:42})).status,400);
      assert.equal(calls.length,0);
    });
    await t.test('malformed and oversized JSON never reach Auth',async()=>{
      for(const [body,status] of [['{',400],['"'+'a'.repeat(70000)+'"',413]]) {
        const res=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:'https://gather.example'},body});
        assert.equal(res.status,status);
      }
      assert.equal(calls.length,0);
    });
    await t.test('hostile and null origins cannot invoke login or email side effects',async()=>{
      for(const route of ['login','signup','forgot-password','resend-confirmation','recovery/verify','recovery/password'])
        for(const Origin of ['https://attacker.example','null'])assert.equal((await post(route,{}, {Origin})).status,403);
      assert.equal(calls.length,0);
    });
    await t.test('legacy password is sent unchanged and tokens are only HttpOnly cookies',async()=>{
      const res=await post('login',{email:' A@EXAMPLE.COM ',password:' old7 '});assert.equal(res.status,200);
      assert.deepEqual(calls.at(-1),['login',{email:'a@example.com',password:' old7 '}]);
      assert(!JSON.stringify(await res.json()).includes('SECRET'));
      assert(res.headers.getSetCookie().every(c=>c.includes('HttpOnly')&&c.includes('SameSite=Lax')));
      assert.equal(res.headers.get('cache-control'),'no-store');
    });
    await t.test('signup sends bounded profile and privacy as atomic Auth metadata',async()=>{
      const profile={firstName:'Alex',lastName:'Smith',username:'alex_s',isPrivate:true,categoryIds:['1']};
      const res=await post('signup',{email:'a@example.com',password:'12345678',profile});assert.equal(res.status,200);
      assert.deepEqual(calls.at(-1)[1].options.data.gather_signup_profile,profile);
      assert.equal((await res.json()).user,null);assert.equal(res.headers.getSetCookie().length,0);
    });
    await t.test('outages, invalid credentials and rate limits have sanitized statuses',async()=>{
      for(const [status,expected] of [[503,503],[400,400],[429,429]]){
        providerError={status,message:'SECRET database row user@example.com'};
        const res=await post('login',{email:'a@example.com',password:'12345678'});
        assert.equal(res.status,expected);assert(!(await res.text()).includes('SECRET'));
      }
      providerError=null;
    });
    await t.test('reset only uses the configured origin and normal login cookies cannot reset passwords',async()=>{
      const res=await post('forgot-password',{email:'a@example.com'});assert.equal(res.status,200);
      assert.deepEqual(calls.at(-1),['reset','a@example.com',{redirectTo:'https://gather.example/recover'}]);
      assert.equal((await post('recovery/password',{password:'newpass123',confirmPassword:'newpass123'},
        {Cookie:'gather_access=SECRET-access; gather_refresh=SECRET-refresh'})).status,401);
    });
    await t.test('recovery page has no-cache, framing, referrer and strict local-script policies',async()=>{
      const res=await fetch(base+'/recover');assert.equal(res.status,200);
      assert.equal(res.headers.get('cache-control'),'no-store');assert.equal(res.headers.get('referrer-policy'),'no-referrer');
      assert.equal(res.headers.get('x-frame-options'),'DENY');assert.match(res.headers.get('content-security-policy'),/frame-ancestors 'none'/);
      const html=await res.text();assert.match(html,/recovery.js/);
      assert.match(html,/Main navigation/);
      assert.match(res.headers.get('content-security-policy'),/font-src 'self' https:\/\/fonts\.gstatic\.com/);
      assert(!/script[^>]+src=["']https?:/i.test(html));
      assert(!/\son(?:click|submit)=/i.test(html));
      const alias=await fetch(base+'/x%2f..%2frecover.html');
      assert.equal(alias.status,200);assert.match(alias.headers.get('content-security-policy'),/script-src 'self'/);
      assert.equal((await fetch(base+'/%ZZ')).status,400);
    });
  }finally{await new Promise(r=>server.close(r));hooks.deregister();delete globalThis.__authHttpClient;}
});
