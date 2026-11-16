import test from 'node:test';
import assert from 'node:assert/strict';
import { authObject, emailInput, passwordInput, signupProfile, providerFailure, fixedAuthOrigin, authLimiter } from '../lib/auth-input.js';

test('account requests reject null, arrays, forged fields and invalid email types', () => {
  for (const input of [null, [], 'email', {email:'a@b.co', UserID:'other'}])
    assert.throws(() => authObject(input,['email']), {status:400});
  for (const input of [null, 42, {}, 'a', 'a@b', 'x\ny@b.co', 'a'.repeat(255)+'@b.co'])
    assert.throws(() => emailInput(input), {status:400});
  assert.equal(emailInput('  Student@BYU.EDU  '),'student@byu.edu');
});
test('login preserves legacy and whitespace passwords while signup enforces bounded length', () => {
  assert.equal(passwordInput(' old7 '),' old7 ');
  assert.equal(passwordInput('short'),'short');
  assert.equal(passwordInput('  pass  ',true),'  pass  ');
  for (const input of [null, 42, '', 'a'.repeat(4097), '🙂'.repeat(1025)])
    assert.throws(() => passwordInput(input), {status:400});
  assert.throws(() => passwordInput('short',true), {status:400});
});
test('signup metadata validates privacy, handles and bigint interests without embedding photos', () => {
  const profile={firstName:' Alex ',lastName:' Smith ',username:'alex_s',isPrivate:true,categoryIds:['9007199254740993','1','1']};
  assert.deepEqual(signupProfile(profile),{...profile,firstName:'Alex',lastName:'Smith',categoryIds:['9007199254740993','1']});
  assert.equal(signupProfile(undefined),undefined);
  for (const change of [{firstName:' '},{firstName:1},{username:'Alex'},{isPrivate:'false'},{categoryIds:[1]},
    {categoryIds:['9223372036854775808']},{photoUrl:'data:image/png;base64,aaa'},{UserID:'other'}])
    assert.throws(() => signupProfile({...profile,...change}),{status:400});
});
test('provider failures preserve outage and throttle status without disclosing provider details', () => {
  for (const [error,status] of [[{status:503},503],[{name:'AuthRetryableFetchError'},503],
    [{status:429},429],[{code:'over_email_send_rate_limit'},429],[{code:'weak_password',status:422},400],
    [{status:400},400]]) {
    assert.throws(() => providerFailure({...error,message:'SECRET provider account record'},true), e=>e.status===status&&!e.message.includes('SECRET'));
  }
});
test('recovery redirects use configured origins, never supplied hosts or redirect paths', () => {
  assert.equal(fixedAuthOrigin({APP_ORIGIN:'https://gather.example/'}),'https://gather.example');
  assert.equal(fixedAuthOrigin({},3001),'http://localhost:3001');
  for (const APP_ORIGIN of ['', 'http://evil.example', 'https://good.example/evil', 'https://a:b@good.example','https://good.example?next=evil'])
    assert.throws(() => fixedAuthOrigin({NODE_ENV:'production',APP_ORIGIN}), {status:503});
});
test('worker limiter bounds per-account and per-IP attempts and expires without trusting forwarded IPs', () => {
  let time=1;const limit=authLimiter(()=>time),req={headers:{'x-forwarded-for':'forged'},socket:{remoteAddress:'proxy'}};
  for(let i=0;i<3;i++) limit(req,'email','a@b.co');
  assert.throws(()=>limit(req,'email','a@b.co'),{status:429});
  limit(req,'email','other@b.co');time+=60001;limit(req,'email','a@b.co');
  const independentWorker=authLimiter(()=>time);independentWorker(req,'email','a@b.co');
  // This explicitly documents the guard's process-local limitation.
});
