// Real DOM checks with mock APIs. Email delivery, provider behavior and RLS are separate checks.
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'@playwright/test');
const root=fileURLToPath(new URL('../public/',import.meta.url));
const server=http.createServer(async(req,res)=>{
  let path=new URL(req.url,'http://localhost').pathname;
  if(['/login','/signup','/recover'].includes(path))path+='.html';
  if(path==='/')path='/index.html';
  const file=resolve(root,'.'+path);
  if(!file.startsWith(root)){res.writeHead(403).end();return;}
  try{res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css'})[extname(file)]||'text/plain');res.end(await readFile(file));}
  catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const base=`http://127.0.0.1:${server.address().port}`;
  await context.route('https://fonts.googleapis.com/**',route=>route.abort());
  let user=null,ready=false,loginError=false,wait=0;const calls=[];
  await context.route('**/api/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname,input=req.postData()?req.postDataJSON():null;
    calls.push([path,input]);let status=200,body;
    if(path==='/api/config')body={mode:'supabase'};
    else if(path==='/api/auth/session')body={user};
    else if(path==='/api/categories')body={categories:[{id:'1',EventCatagory:'Arts'}]};
    else if(path==='/api/settings')body={firstName:'Alex',lastName:'Smith',username:'alex_test',isPrivate:true,categoryIds:['1'],categories:[]};
    else if(path==='/api/auth/login'){
      if(wait)await new Promise(r=>setTimeout(r,wait));
      if(loginError){status=400;body={error:'Email or password is incorrect. Use account help.'};}
      else{user={id:'a',email:'a@example.com',name:'Alex'};body={user};}
    }else if(path==='/api/auth/signup')body={user:null,message:'Check your email.'};
    else if(path==='/api/auth/forgot-password'||path==='/api/auth/resend-confirmation')body={message:'If this email is eligible, check your inbox and spam folder.'};
    else if(path==='/api/auth/recovery/status'){status=ready?200:401;body=ready?{ready:true,email:'a@example.com'}:{error:'No recovery session'};}
    else if(path==='/api/auth/recovery/verify'){ready=true;body={ready:true,email:'a@example.com'};}
    else if(path==='/api/auth/recovery/password'){ready=false;body={ok:true,sessionsRevoked:true};}
    else{status=404;body={error:'Unexpected mock endpoint'};}
    await route.fulfill({status,json:body});
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/login');
  const login=page.locator('#app form');
  await login.getByLabel('Email',{exact:true}).fill('a@example.com');
  await login.getByLabel('Password',{exact:true}).fill('short7');
  assert.equal(await login.getByLabel('Password',{exact:true}).getAttribute('minlength'),'1');
  loginError=true;await login.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByText('Email or password is incorrect. Use account help.',{exact:true}).waitFor();
  await page.getByRole('link',{name:/Forgot your password/}).click();
  await page.getByLabel('Email',{exact:true}).fill('a@example.com');
  // Navigation must preserve the in-progress form and work on mobile keyboards.
  const recoveryHeader=page.locator('header');
  assert.equal(await recoveryHeader.getByRole('link',{name:'Gather home'}).getAttribute('href'),'/');
  assert.equal(await page.getByRole('link',{name:'Request another email',exact:true}).count(),0);
  await page.getByRole('button',{name:'Open navigation',exact:true}).click();
  await page.getByRole('dialog',{name:'Navigation',exact:true}).waitFor();
  await page.getByRole('button',{name:'Close menu',exact:true}).evaluate(el=>el.focus());
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.locator('#sideUserButton').evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#drawer').isHidden(),true);
  assert.equal(await page.locator('#menuButton').evaluate(el=>el===document.activeElement),true);
  assert.equal(await page.getByLabel('Email',{exact:true}).inputValue(),'a@example.com');
  await page.setViewportSize({width:1280,height:900});
  await page.getByRole('navigation',{name:'Main navigation',exact:true}).waitFor();
  assert.equal(await recoveryHeader.getByRole('link',{name:'Events',exact:true}).getAttribute('href'),'/events');
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.getByRole('link',{name:'Back to sign in',exact:true}).click();
  await page.waitForURL(base+'/login');
  await page.getByRole('link',{name:/Forgot your password/}).click();
  await page.getByLabel('Email',{exact:true}).fill('a@example.com');
  await page.getByRole('button',{name:'Send email',exact:true}).click();
  await page.getByText(/If this email is eligible/).waitFor();
  // Open the emailed link in a fresh document.
  await page.goto('about:blank');
  await page.goto(base+'/recover#token_hash=mock-token-12345678901234567890');
  await page.getByRole('heading',{name:'Continue password recovery'}).waitFor();
  assert.equal(new URL(page.url()).hash,'');assert.equal(calls.filter(c=>c[0].endsWith('/verify')).length,0);
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByRole('heading',{name:'Choose a new password'}).waitFor();
  await page.reload();await page.getByRole('heading',{name:'Choose a new password'}).waitFor();
  await page.getByLabel('New password',{exact:true}).fill('new-password-123');
  await page.getByLabel('Confirm password',{exact:true}).fill('different-password');
  await page.getByRole('button',{name:'Change password',exact:true}).click();
  await page.getByText('Passwords do not match.',{exact:true}).waitFor();
  assert.equal(calls.filter(c=>c[0].endsWith('/recovery/password')).length,0);
  await page.getByLabel('Confirm password',{exact:true}).fill('new-password-123');
  await page.getByRole('button',{name:'Change password',exact:true}).click();
  await page.getByRole('heading',{name:'Password changed'}).waitFor();
  assert.equal(await page.locator('input[type=password]').count(),0);
  await page.goto(base+'/signup');
  await page.getByLabel('First name',{exact:true}).fill('Alex');
  await page.getByLabel('Last name',{exact:true}).fill('Smith');
  await page.getByLabel('Username',{exact:true}).fill('Alex_Test');
  await page.getByLabel('Email',{exact:true}).fill('a@example.com');
  await page.getByLabel('Password',{exact:true}).fill('strong-password-123');
  await page.getByLabel('Confirm password',{exact:true}).fill('strong-password-123');
  await page.getByRole('button',{name:'Next: Personalize',exact:true}).click();
  await page
  .locator('#signupStep2 select[name="visibility"]')
  .selectOption('private');
  await page.getByRole('checkbox',{name:/Arts/}).check();
  await page.getByRole('button',{name:'Create account',exact:true}).click();
  await page.getByRole('heading',{name:'Check your email'}).waitFor();
  const signup=calls.find(c=>c[0]==='/api/auth/signup')[1];
  assert.deepEqual(signup.profile,{firstName:'Alex',lastName:'Smith',username:'alex_test',isPrivate:true,categoryIds:['1']});
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('gatherPendingSignup')),null);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);
  console.log('PASS: login legacy password/error/help, generic reset request, manual token consumption, recovery refresh, mismatch, password removal, durable signup profile payload, mobile, shared recovery header/navigation, menu focus, back to sign in.');
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
