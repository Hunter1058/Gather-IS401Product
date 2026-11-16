'use strict';
// The emailed hash remains in memory only. Never send it through URL queries,
// localStorage, analytics or a normal login/session endpoint.
const recoveryApp=document.getElementById('recoveryApp');
const recoveryParams=new URLSearchParams(location.hash.slice(1));
let recoveryHash=recoveryParams.get('token_hash') || '';
const unsupportedRecoveryLink=recoveryParams.has('access_token') || recoveryParams.has('error_description');
history.replaceState(null,'',location.pathname);
const recoveryEsc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function recoveryApi(path,body) {
  const response=await fetch('/api/auth/'+path,{credentials:'same-origin',method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  let result;try {result=await response.json();}catch{throw Error('Account service is temporarily unavailable. Please try again.');}
  if(!response.ok) throw Error(result.error || 'Unable to complete recovery. Please try again.');
  return result;
}
function recoveryMessage(message){document.getElementById('recoveryMessage').textContent=message;}
function recoveryForm(title,content,submit) {
  recoveryApp.innerHTML=`<form class="auth" id="recoveryForm"><h1 tabindex="-1">${title}</h1>${content}<p id="recoveryMessage" role="status" aria-live="polite"></p><button class="primary" type="submit">${submit}</button><p><a href="/login">Back to sign in</a></p></form>`;
}
function requestRecovery() {
  recoveryForm('Need help signing in?', '<p>Sign in with your email address. You don’t need to remember your username.</p><label>Email<input name="email" type="email" maxlength="254" autocomplete="email" required></label><label>What do you need?<select name="action"><option value="forgot-password">Reset my password</option><option value="resend-confirmation">Resend confirmation email</option></select></label><p class="muted">If you forgot which email you used, check your password manager or previous Gather emails. If you cannot access that mailbox, recover it with your email provider or ask the project team about verified support. We won’t reveal account email addresses from a name lookup.</p>','Send email');
  document.getElementById('recoveryForm').addEventListener('submit',async event=>{
    event.preventDefault();const button=event.currentTarget.querySelector('[type=submit]');if(button.disabled)return;
    button.disabled=true;const fields=new FormData(event.currentTarget);recoveryMessage('Sending…');
    try {const result=await recoveryApi(fields.get('action'),{email:fields.get('email')});recoveryMessage(result.message);}
    catch(error){recoveryMessage(error.message);}
    finally{button.disabled=false;}
  });
}
function newPassword(email) {
  recoveryForm('Choose a new password',`<p>Changing the password for <strong>${recoveryEsc(email || 'the verified account')}</strong>.</p><label>New password<input name="password" type="password" minlength="8" required autocomplete="new-password"></label><label>Confirm password<input name="confirmPassword" type="password" minlength="8" required autocomplete="new-password"></label><p class="muted">Use at least 8 characters and your account’s password requirements. You’ll sign in again afterwards.</p>`,'Change password');
  document.getElementById('recoveryForm').addEventListener('submit',async event=>{
    event.preventDefault();const button=event.currentTarget.querySelector('[type=submit]');if(button.disabled)return;
    const form=event.currentTarget,fields=new FormData(form);
    if(fields.get('password')!==fields.get('confirmPassword')){recoveryMessage('Passwords do not match.');return;}
    button.disabled=true;recoveryMessage('Changing password…');
    try {
      const result=await recoveryApi('recovery/password',{password:fields.get('password'),confirmPassword:fields.get('confirmPassword')});
      form.reset();
      recoveryApp.innerHTML='<section class="auth"><h1 tabindex="-1">Password changed</h1><p>Sign in with your new password.</p>'+(result.sessionsRevoked?'':'<p>We could not confirm that other sessions were signed out. Contact the project team if you suspect your account was compromised.</p>')+'<a href="/login">Go to sign in</a></section>';
      recoveryApp.querySelector('h1').focus();
    } catch(error){recoveryMessage(error.message);button.disabled=false;}
  });
}
async function recoveryBoot() {
  if(recoveryHash) {
    recoveryForm('Continue password recovery','<p>Continue only if you requested this password reset. Your password has not changed.</p>','Continue');
    document.getElementById('recoveryForm').addEventListener('submit',async event=>{
      event.preventDefault();const button=event.currentTarget.querySelector('[type=submit]');if(button.disabled)return;
      button.disabled=true;recoveryMessage('Checking link…');
      try {const result=await recoveryApi('recovery/verify',{tokenHash:recoveryHash});recoveryHash='';newPassword(result.email);}
      catch(error){recoveryMessage(error.message);button.disabled=false;}
    });
    return;
  }
  try {const status=await recoveryApi('recovery/status');if(status.ready){newPassword(status.email);return;}}catch{}
  requestRecovery();
  if(unsupportedRecoveryLink) recoveryMessage('This email link could not start recovery. Request a new link. If the problem continues, ask the project team to check the reset email template.');
}
void recoveryBoot();
