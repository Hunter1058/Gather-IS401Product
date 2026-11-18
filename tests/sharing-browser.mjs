// Real browser -> real Node share/view APIs -> isolated PostgreSQL (no remote DB).
import assert from 'node:assert/strict';
import * as modules from 'node:module';
import {chromium} from '@playwright/test';
import {sharingDatabase,A,B,C} from './helpers/sharing-database.js';
const store=await sharingDatabase();
Object.assign(process.env,{NODE_ENV:'test',SUPABASE_URL:'https://fixture.invalid',SUPABASE_KEY:'test-publishable'});
let shareFailure=false;
globalThis.__sharingBrowserClient=()=>{
  let actor=null;
  return {auth:{
    async setSession({access_token,refresh_token}) {
      actor=[A,B,C].includes(access_token)&&refresh_token==='refresh'?access_token:null;
      return actor?{data:{session:{access_token,refresh_token}}}:{error:{status:401}};
    },
    async getUser(){return {data:{user:actor?{id:actor}:null}};},
  },async rpc(name,args){
    if(shareFailure&&name==='gather_share_event')return {error:{code:'PGRST202'}};
    try {const data=name==='gather_share_event'
      ?await store.send(actor,args.p_event_id,args.p_channel,args.p_recipient,args.p_request_id)
      :await store.inbox(actor,args.p_after,args.p_limit);
      return {data:JSON.parse(JSON.stringify(data))};
    } catch(error){return {error};}
  },from(table){
    let id,payload;
    const q={select(){return q;},eq(_column,value){id=value;return q;},maybeSingle(){return q;},insert(value){payload=value;return q;},
      then(resolve,reject){return (async()=>{
        try {
          if(table==='Events')return {data:(await store.asUser(actor,'select "EventID"::text from public."Events" where "EventID"=$1',[id]))[0]||null};
          if(table==='EventInteractionLog') {
            await store.asUser(actor,`insert into public."EventInteractionLog" ("UserID","EventID","InteractionType","RecipientUserID") values ($1,$2,$3,$4)`,[payload.UserID,payload.EventID,payload.InteractionType,payload.RecipientUserID]);
            return {error:null};
          }
          throw Error('Unexpected fixture table');
        } catch(error){return {error};}
      })().then(resolve,reject);}};return q;
  }};
};
const hooks=modules.registerHooks({resolve(specifier,context,next){
  if(specifier==='@supabase/supabase-js')return {url:'data:text/javascript,export const createClient=()=>globalThis.__sharingBrowserClient();',shortCircuit:true};
  return next(specifier,context);
}});
const {server}=await import('../server.js');await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
let browser;
const events=['1','9007199254740993'].map(id=>({id,name:id==='1'?'Jazz <friends>':'Big event',category:'Arts',categories:['Arts'],location:'Campus',date:'2099-11-05',start:'18:30',end:null,price:0,food:false}));
const count=async(type='share')=>(await store.db.query('select count(*)::int as count from public."EventInteractionLog" where "InteractionType"=$1',[type])).rows[0].count;
try {
  browser=await chromium.launch({headless:true});
  const errors=[];
  async function makeContext(actor) {
    const context=await browser.newContext({viewport:{width:390,height:844}});
    await context.addCookies([{name:'gather_access',value:actor,url:base,httpOnly:true},{name:'gather_refresh',value:'refresh',url:base,httpOnly:true}]);
    await context.addInitScript(()=>{
      navigator.share=async()=>{};
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{async writeText(){}}});
    });
    await context.route('https://fonts.googleapis.com/**',route=>route.abort());
    await context.route('**/api/**',async route=>{
      const url=new URL(route.request().url()),path=url.pathname;
      if(path.endsWith('/share')||path.endsWith('/view')||path==='/api/shared-events')return route.continue();
      let body;
      if(path==='/api/config')body={mode:'supabase'};
      else if(path==='/api/auth/session')body={user:{id:actor,name:actor===A?'Alex':'Blair'}};
      else if(path==='/api/events')body={events:url.searchParams.has('eventId')?events.filter(e=>e.id===url.searchParams.get('eventId')):events};
      else if(path==='/api/settings')body={categories:[],categoryIds:[]};
      else if(path==='/api/state')body={accountId:actor,state:{saved:[],rsvp:[]}};
      else if(path==='/api/friends/people')body={accountId:actor,people:[{id:B,name:'@blair',relationship:'friends'},{id:C,name:'Casey',relationship:'outgoing_pending'}],nextCursor:null};
      else return route.fulfill({status:404,json:{error:'Unknown fixture route'}});
      return route.fulfill({json:body});
    });
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));return {context,page};
  }
  const {page}=await makeContext(A);
  for(const path of ['/events','/']) {
    await page.goto(base+path);await page.locator('.event-title, .discover-view-event').first().waitFor();
    const beforeViews=await count('view'),before=await count();
    const viewed=page.waitForResponse(r=>r.url().endsWith('/events/1/view'));
    await page.locator('.event-title, .discover-view-event').first().click();await viewed;
    assert.equal(await count('view'),beforeViews+1);
    await page.locator('#modal .event-share').click();
    await page.locator('#eventShareDialog').waitFor();assert.equal(await count(),before);
    for(const width of [320,390,1280]) {
      await page.setViewportSize({width,height:844});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    }
    await page.setViewportSize({width:390,height:844});
    const native=page.waitForResponse(r=>r.url().endsWith('/events/1/share'));
    await page.getByRole('button',{name:'Share with device',exact:true}).click();assert.equal((await native).status(),200);
    assert.equal(await count(),before+1);
    await page.evaluate(()=>{navigator.share=async()=>{throw Object.assign(Error(),{name:'AbortError'});};});
    await page.getByRole('button',{name:'Share with device',exact:true}).click();
    await page.waitForFunction(()=>externalSharesPending.size===0);assert.equal(await count(),before+1);
    await page.evaluate(()=>{navigator.clipboard.writeText=async()=>{throw Error('blocked');};});
    await page.getByRole('button',{name:'Copy link',exact:true}).click();
    await page.getByText(/Copy was unavailable/).waitFor();assert.equal(await count(),before+1);
    await page.evaluate(()=>{navigator.clipboard.writeText=async()=>{};});
    const copy=page.waitForResponse(r=>r.url().endsWith('/events/1/share'));
    await page.getByRole('button',{name:'Copy link',exact:true}).click();assert.equal((await copy).status(),200);
    assert.equal(await count(),before+2);
    await page.getByRole('button',{name:'Choose a friend',exact:true}).click();
    await page.locator('#eventShareFriend').waitFor();
    assert.equal(await page.locator(`#eventShareFriend option[value="${C}"]`).count(),0);
    await page.locator('#eventShareFriend').selectOption(B);
    const send=page.waitForResponse(r=>r.url().endsWith('/events/1/share'));
    await page.getByRole('button',{name:'Send event',exact:true}).evaluate(button=>{button.click();button.click();});
    assert.equal((await send).status(),200);await page.getByText('Event sent to your friend.',{exact:true}).first().waitFor();
    assert.equal(await count(),before+3);
    assert.equal(await count('view'),beforeViews+1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.keyboard.press('Escape');assert.equal(await page.locator('#eventShareDialog').evaluate(el=>el.open),false);
    assert.equal(await page.locator('#modal').evaluate(el=>el.open),true);
    await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.getElementById('modal').open);
    const reopened=page.waitForResponse(r=>r.url().endsWith('/events/1/view'));
    await page.locator('.event-title, .discover-view-event').first().click();await reopened;
    assert.equal(await count('view'),beforeViews+2);
  }
  // Failed direct sends show an error and keep the recipient unnotified.
  await page.locator('#modal .event-share').click();await page.getByRole('button',{name:'Choose a friend',exact:true}).click();
  await page.locator('#eventShareFriend').selectOption(B);shareFailure=true;const beforeFailed=await count();
  await page.getByRole('button',{name:'Send event',exact:true}).click();await page.getByRole('alert').filter({hasText:'Sharing database setup is incomplete'}).waitFor();
  assert.equal(await count(),beforeFailed);assert.equal(await page.locator('#eventShareDialog').getByText('Event sent to your friend.',{exact:true}).count(),0);
  shareFailure=false;await page.getByRole('button',{name:'Send event',exact:true}).click();
  await page.getByText('Event sent to your friend.',{exact:true}).first().waitFor();assert.equal(await count(),beforeFailed+1);
  // Simulate a committed send whose response is lost; retry must not redeliver.
  await page.getByRole('button',{name:'Close share dialog',exact:true}).click();
  await page.locator('#modal .event-share').click();await page.getByRole('button',{name:'Choose a friend',exact:true}).click();
  await page.locator('#eventShareFriend').selectOption(B);
  const beforeLost=await count();
  await page.route('**/api/events/1/share',async route=>{await route.fetch();await route.abort();},{times:1});
  await page.getByRole('button',{name:'Send event',exact:true}).click();
  await page.locator('#eventShareDialog [role="alert"]').waitFor();assert.equal(await count(),beforeLost+1);
  await page.getByRole('button',{name:'Send event',exact:true}).click();
  await page.locator('#eventShareDialog').getByText('Event sent to your friend.',{exact:true}).waitFor();
  assert.equal(await count(),beforeLost+1);
  const recipient=await makeContext(B);await recipient.page.goto(base+'/#friends');
  await recipient.page.getByRole('tab',{name:'Shared with Me',exact:true}).click();
  await recipient.page.locator('.shared-event').first().waitFor();
  assert.match(await recipient.page.locator('.shared-event').first().textContent(),/Alex Sender/);
  await recipient.page.locator('.shared-event').first().getByRole('link',{name:'Open event details'}).click();
  await recipient.page.locator('#modal[open]').waitFor();assert.match(await recipient.page.locator('#modal h2').textContent(),/Jazz/);
  const outsider=await makeContext(C);await outsider.page.goto(base+'/#friends');
  await outsider.page.getByRole('tab',{name:'Shared with Me',exact:true}).click();
  await outsider.page.getByText('No events have been shared with you yet.',{exact:true}).waitFor();
  assert.equal(await outsider.page.locator('.shared-event').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: mobile/desktop browser + real Node + isolated PostgreSQL: native/copy/cancel/fallback, accepted friend delivery, duplicate suppression, errors/retry/lost-response idempotency, recipient isolation, inbox/details, preserved view logging and Escape.');
} finally {
  if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));hooks.deregister();delete globalThis.__sharingBrowserClient;await store.db.close();
}
