import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {A,B,C} from './helpers/sharing-database.js';
const source=await readFile(new URL('../public/event-sharing.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({navigator={},actor=A,request}={}) {
  const elements=new Map(),calls=[],toasts=[],warnings=[];
  const make=()=>({innerHTML:'',textContent:'',open:false,id:'',listeners:{},
    setAttribute(){},focus(){},select(){},addEventListener(name,fn){this.listeners[name]=fn;},
    showModal(){this.open=true;},close(){this.open=false;this.listeners.close?.();}});
  const element=id=>{if(!elements.has(id))elements.set(id,{...make(),id});return elements.get(id);};
  const context=vm.createContext({URL,Map,Set,Date,crypto:webcrypto,encodeURIComponent,navigator,
    events:[{id:'1',name:'Jazz <friends>'}],data:{user:actor?{id:actor}:null},backendMode:'supabase',page:'friends',friendsTab:'shared',
    location:{href:'https://fixture/events'},console:{warn(...args){warnings.push(args);}},
    icon(){return '';},esc(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));},
    $:element,toast(value){toasts.push(value);},render(){},
    document:{getElementById(id){return id==='eventShareDialog'?elements.get(id):element(id);},createElement:make,
      body:{append(el){elements.set(el.id,el);}}},
    async fetch(path,options={}){
      calls.push({path,options});
      if(request)return request(path,options);
      const result=path.includes('/friends/people')?{accountId:actor,people:[{id:B,name:'Blair <friend>',relationship:'friends'},{id:C,name:'Pending',relationship:'outgoing_pending'}],nextCursor:null}
        :path.includes('/shared-events')?{accountId:actor,shares:[],nextCursor:null}:{accountId:actor,interactionId:'9007199254740993'};
      return {ok:true,async json(){return result;}};
    },
  });
  context.window=context;vm.runInContext(source,context);
  return {context,calls,toasts,warnings,element,run:code=>vm.runInContext(code,context)};
}

test('opening share menu alone logs nothing; successful native/copy actions log once with channel and no recipient',async()=>{
  for(const channel of ['native','copy_link']) {
    const f=fixture({navigator:{async share(){},clipboard:{async writeText(){}}}});
    f.run('openEventShare("1")');assert.equal(f.calls.length,0);
    await f.run(channel==='native'?'shareEvent("1")':'copyEventLink("1")');await tick();
    assert.equal(f.calls.length,1);const input=JSON.parse(f.calls[0].options.body);
    assert.equal(input.channel,channel);assert.equal(input.recipientId,undefined);assert.match(input.requestId,/^[\da-f-]{36}$/);
    assert.equal(f.calls[0].options.headers['X-Gather-Account'],A);
  }
});
test('native cancellation and failed copies never count; manual URL selection does not count and confirmed retry does',async()=>{
  const canceled=fixture({navigator:{async share(){throw Object.assign(Error(),{name:'AbortError'});}}});
  await canceled.run('shareEvent("1")');assert.equal(canceled.calls.length,0);
  const failed=fixture({navigator:{clipboard:{async writeText(){throw Error('blocked');}}}});
  await failed.run('copyEventLink("1")');assert.equal(failed.calls.length,0);
  assert.equal(failed.element('eventShareDialog').open,true);
  assert.match(failed.element('eventCopyStatus').textContent,/unavailable/);
  failed.context.navigator.clipboard.writeText=async()=>{};
  await failed.run('copyEventLink("1")');await tick();assert.equal(failed.calls.length,1);
});
test('native failure retains clipboard fallback; guest shares work without analytics and analytics failures are quiet',async()=>{
  const native=fixture({navigator:{async share(){throw Error('unavailable');},clipboard:{async writeText(){}}}});
  await native.run('shareEvent("1")');await tick();assert.equal(JSON.parse(native.calls[0].options.body).channel,'copy_link');
  const guest=fixture({actor:null,navigator:{clipboard:{async writeText(){}}}});
  await guest.run('copyEventLink("1")');assert.equal(guest.calls.length,0);assert.match(guest.toasts[0],/copied/);
  for(const request of [async()=>{throw Error('offline');},async()=>({ok:false,async json(){return {error:'Unavailable'};}})]) {
    const f=fixture({navigator:{clipboard:{async writeText(){}}},request});
    await f.run('copyEventLink("1")');await tick();assert.match(f.toasts[0],/copied/);
    assert.equal(f.warnings.length,1);assert.equal(f.calls.length,1);
  }
});
test('overlapping native/copy handlers cannot double-count an external browser action',async()=>{
  let release;const f=fixture({navigator:{share(){return new Promise(resolve=>{release=resolve;});}}});
  const first=f.run('shareEvent("1")');await f.run('shareEvent("1"); copyEventLink("1")');
  release();await first;await tick();assert.equal(f.calls.length,1);
});
test('picker filters to accepted friends and double clicks send one confirmed delivery',async()=>{
  const f=fixture();f.run('openEventShare("1")');await f.run('loadEventShareFriends()');
  assert.match(f.element('eventShareDialog').innerHTML,/Blair &lt;friend&gt;/);assert.doesNotMatch(f.element('eventShareDialog').innerHTML,/Pending/);
  f.run(`selectEventShareFriend('${B}')`);
  let release;const original=f.context.fetch;
  f.context.fetch=async(...args)=>{if(args[0].endsWith('/share'))await new Promise(resolve=>{release=resolve;});return original(...args);};
  const pending=f.run('sendGatherEvent()');await f.run('sendGatherEvent()');
  assert.equal(f.toasts.length,0);assert.match(f.element('eventShareDialog').innerHTML,/Sending/);
  release();await pending;await f.run('sendGatherEvent()');
  const sends=f.calls.filter(c=>c.path.endsWith('/share'));assert.equal(sends.length,1);
  assert.equal(JSON.parse(sends[0].options.body).recipientId,B);assert.match(f.toasts[0],/sent/);
});
test('failed sends never show success, explicit retries reuse idempotency keys, closing ignores late responses',async()=>{
  const f=fixture();f.run('openEventShare("1")');await f.run('loadEventShareFriends()');f.run(`selectEventShareFriend('${B}')`);
  const original=f.context.fetch;
  f.context.fetch=async(path,options)=>{
    if(path.endsWith('/share')) {f.calls.push({path,options});throw Error('Network lost');}return original(path,options);
  };
  await f.run('sendGatherEvent()');assert.equal(f.toasts.length,0);assert.match(f.element('eventShareDialog').innerHTML,/Network lost/);
  const first=JSON.parse(f.calls.at(-1).options.body);
  f.context.fetch=original;await f.run('sendGatherEvent()');assert.equal(JSON.parse(f.calls.at(-1).options.body).requestId,first.requestId);
  f.run('shareDialog().close(); openEventShare("1")');await f.run('loadEventShareFriends()');f.run(`selectEventShareFriend('${B}')`);
  let release;f.context.fetch=async(...args)=>{await new Promise(resolve=>{release=resolve;});return original(...args);};
  const pending=f.run('sendGatherEvent()');f.run('shareDialog().close()');release();await pending;
  assert.equal(f.element('eventShareDialog').open,false);assert.equal(f.toasts.length,1);
});
test('inbox escapes sender/event names, links to event details, and clears on account changes',async()=>{
  const f=fixture({request:async()=>({ok:true,async json(){return {accountId:A,shares:[{id:'9007199254740993',eventId:'9223372036854775807',eventName:'Jazz <event>',senderName:'Blair <friend>',createdAt:'2026-11-17T12:00:00Z'}],nextCursor:null};}})});
  await f.run('loadReceivedEventShares()');const html=f.run('receivedEventSharesMarkup()');
  assert.match(html,/Jazz &lt;event&gt;/);assert.match(html,/Blair &lt;friend&gt;/);assert.match(html,/event=9223372036854775807/);
  f.context.data.user={id:C};assert.doesNotMatch(f.run('receivedEventSharesMarkup()'),/Blair/);
});


test('account mismatch clears friend choices and blocks further sends; mismatched inbox responses clear cached shares',async()=>{
  const f=fixture();f.run('openEventShare("1")');await f.run('loadEventShareFriends()');f.run(`selectEventShareFriend('${B}')`);
  f.context.fetch=async()=>({ok:false,status:409,async json(){return {error:'Your account changed. Reload.'};}});
  await f.run('sendGatherEvent()');
  assert.doesNotMatch(f.element('eventShareDialog').innerHTML,/Blair &lt;friend&gt;/);
  assert.equal(f.run('eventShareState.blocked'),true);const count=f.calls.length;
  await f.run('sendGatherEvent()');assert.equal(f.calls.length,count);
  f.run(`receivedEventShares={owner:'${A}',items:[{id:'1',eventId:'1',eventName:'OLD PRIVATE SHARE',senderName:'Previous',createdAt:'2026-11-17T12:00:00Z'}],next:null,loading:false,ready:true,error:''}`);
  await f.run('loadReceivedEventShares()');assert.doesNotMatch(f.run('receivedEventSharesMarkup()'),/OLD PRIVATE SHARE/);
});


test('missing sharing setup is diagnosed without interfering with a successful copy',async()=>{
  const f=fixture({navigator:{clipboard:{async writeText(){}}},request:async()=>({
    ok:false,status:503,async json(){return {error:'Sharing database setup is incomplete.',code:'SHARING_SETUP_REQUIRED'};},
  })});
  await f.run('copyEventLink("1")');await tick();
  assert.equal(f.toasts.length,1);assert.match(f.toasts[0],/copied/);
  assert.equal(f.calls.length,1);assert.equal(f.warnings.length,1);
  assert(f.warnings[0].includes('SHARING_SETUP_REQUIRED'));
});
