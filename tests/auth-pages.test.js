import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

async function recoveryPage({hash='',status=null}={}) {
  const elements=new Map(),calls=[];let failure=null,hold=null;
  function el(id){if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',disabled:false,events:{},
    focus(){},reset(){this.wasReset=true;},querySelector(selector){return el(selector);},addEventListener(kind,fn){this.events[kind]=fn;}});return elements.get(id);}
  const context=vm.createContext({URLSearchParams,location:{hash,pathname:'/recover'},history:{replaceState(...args){calls.push(['history',...args]);}},
    document:{getElementById:el},FormData:class{constructor(form){this.values=form.values;}get(key){return this.values[key];}},
    async fetch(path,options){calls.push([path,options.body&&JSON.parse(options.body)]);if(hold)await hold;
      let result={ready:true,email:'a<test>@example.com'};
      if(path.endsWith('/status')) result=status;
      if(path.endsWith('/forgot-password'))result={message:'If eligible, check your inbox.'};
      if(path.endsWith('/password'))result={ok:true,sessionsRevoked:false};
      return {ok:!!result&&!failure,async json(){return failure?{error:failure}:result||{error:'No recovery'};}};
    }});
  const source=(await readFile(new URL('../public/recovery.js',import.meta.url),'utf8')).replace('void recoveryBoot();','globalThis.ready=recoveryBoot();');
  vm.runInContext(source,context);await context.ready;
  const submit=async values=>{const form=el('recoveryForm');form.values=values;await form.events.submit({preventDefault(){},currentTarget:form});};
  return {el,calls,context,submit,fail(message){failure=message;},hold(promise){hold=promise;}};
}
test('emailed recovery hashes are removed from browser URL and are not consumed on page load',async()=>{
  const f=await recoveryPage({hash:'#token_hash=private-hash-12345678901234567890'});
  assert.equal(f.calls[0][0],'history');assert.equal(f.calls.length,1);
  assert.match(f.el('recoveryApp').innerHTML,/Continue password recovery/);
  await f.submit({});assert.equal(f.calls[1][0],'/api/auth/recovery/verify');
  assert.match(f.el('recoveryApp').innerHTML,/a&lt;test&gt;@example.com/);
  assert(!f.el('recoveryApp').innerHTML.includes('private-hash'));
});
test('password mismatch makes no request and successful reset removes form and reports revocation failure',async()=>{
  const f=await recoveryPage({status:{ready:true,email:'a@example.com'}}),count=f.calls.length;
  await f.submit({password:'newpass123',confirmPassword:'different'});
  assert.equal(f.calls.length,count);assert.match(f.el('recoveryMessage').textContent,/do not match/);
  await f.submit({password:'newpass123',confirmPassword:'newpass123'});
  assert.equal(f.el('recoveryForm').wasReset,true);assert.match(f.el('recoveryApp').innerHTML,/Password changed/);
  assert.match(f.el('recoveryApp').innerHTML,/could not confirm/);assert(!f.el('recoveryApp').innerHTML.includes('type="password"'));
});
test('account help provides email recovery without exposing account lookup and suppresses duplicate submits',async()=>{
  const f=await recoveryPage();assert.match(f.el('recoveryApp').innerHTML,/email provider/);
  let release;f.hold(new Promise(r=>release=r));const first=f.submit({email:'a@example.com',action:'forgot-password'});
  const duplicate=f.submit({email:'a@example.com',action:'forgot-password'});
  await duplicate;assert.equal(f.calls.filter(c=>c[0]==='/api/auth/forgot-password').length,1);
  release();await first;assert.equal(f.el('[type=submit]').disabled,false);
  assert.match(f.el('recoveryMessage').textContent,/If eligible/);
});
test('recovery failures are displayed as text and preserve a retry action',async()=>{
  const f=await recoveryPage({hash:'#token_hash=invalid-link-12345678901234567890'});
  f.fail('<img src=x onerror=alert(1)>');await f.submit({});
  assert.equal(f.el('recoveryMessage').textContent,'<img src=x onerror=alert(1)>');
  assert.equal(f.el('[type=submit]').disabled,false);
});

async function loginPage(pending=null) {
  const elements=new Map(),requests=[],stored=new Map(pending?[['gatherPendingSignup',JSON.stringify(pending)]]:[]);
  const el=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',disabled:false,classList:{add(){},remove(){}},
    setAttribute(){},append(){},querySelector(){return el('submit');},addEventListener(){}});return elements.get(id);};
  const context=vm.createContext({console,URL,TextEncoder,location:{pathname:'/login',search:'',protocol:'http:',assign(value){this.redirect=value;}},
    history:{replaceState(){}},document:{getElementById:el,addEventListener(){},createElement(){return {};}},localStorage:{getItem(){return null;}},
    sessionStorage:{getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},
    FormData:class{constructor(form){this.form=form;}[Symbol.iterator](){return Object.entries(this.form.values)[Symbol.iterator]();}},
    async fetch(path,options={}){requests.push([path,options.body&&JSON.parse(options.body)]);
      const result=path==='/api/auth/login'?{user:{id:'a',email:'a@example.com'}}:{firstName:'Current',lastName:'Name',username:'current',isPrivate:false,categoryIds:['2']};
      return {ok:true,async json(){return result;}};}});
  context.window=context;
  const source=(await readFile(new URL('../public/auth.js',import.meta.url),'utf8')).replace(/boot\(\);\s*$/,'');
  vm.runInContext(source,context);vm.runInContext('backendMode="supabase"',context);
  return {el,requests,stored,run:code=>vm.runInContext(code,context),context};
}
test('login form accepts legacy passwords and links to account help',async()=>{
  const f=await loginPage(),html=f.run('auth(false)');assert.match(html,/minlength="1"/);assert.match(html,/href="\/recover"/);
});
test('photo drafts apply only to the verified matching account and preserve current profile privacy',async()=>{
  const f=await loginPage({email:'a@example.com',photoUrl:'data:image/png;base64,aaa',profile:{firstName:'Stale',isPrivate:true}});
  await f.run('finishSignupPhoto({id:"b",email:"b@example.com"})');assert.equal(f.requests.length,0);
  await f.run('finishSignupPhoto({id:"a",email:"a@example.com"})');
  const saved=f.requests.find(c=>c[1]);assert.equal(saved[1].firstName,'Current');assert.equal(saved[1].isPrivate,false);
  assert.deepEqual(saved[1].categoryIds,['2']);assert.equal(f.stored.size,0);
});
test('login pending guard makes one auth request and never stores a password draft',async()=>{
  const f=await loginPage();
  f.context.form={values:{email:'a@example.com',password:'short7'},querySelector:()=>f.el('submit')};
  await Promise.all([f.run('authenticate({preventDefault(){},target:form},false)'),f.run('authenticate({preventDefault(){},target:form},false)')]);
  assert.equal(f.requests.filter(c=>c[0]==='/api/auth/login').length,1);assert.equal(f.stored.size,0);
  assert.equal(f.context.location.redirect,'/');assert.equal(f.el('submit').disabled,false);
});
test('non-JSON proxy outages leave login retryable with a friendly message',async()=>{
  const f=await loginPage();
  f.context.form={values:{email:'a@example.com',password:'pass1234'},querySelector:()=>f.el('submit')};
  f.context.fetch=async()=>({ok:false,async json(){throw new SyntaxError('Unexpected token < in secret upstream HTML');}});
  await f.run('authenticate({preventDefault(){},target:form},false)');
  assert.match(f.el('authError').textContent,/temporarily down/);
  assert(!f.el('authError').textContent.includes('secret'));assert.equal(f.el('submit').disabled,false);
  assert.equal(f.context.location.redirect,undefined);
});
