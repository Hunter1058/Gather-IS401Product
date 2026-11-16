import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { authFailure, providerFailure, authObject, emailInput, passwordInput, fixedAuthOrigin } from './auth-input.js';
const COOKIE='gather_recovery', TTL=15*60, AAD=Buffer.from('gather-recovery-v1');
export function passwordRecovery({makeClient,sessionCookies,secure,env=process.env,port,limit,now=Date.now}) {
  const enabled=()=>typeof env.AUTH_RECOVERY_SECRET==='string' && env.AUTH_RECOVERY_SECRET.length>=32;
  const key=()=>{if(!enabled()) throw authFailure('Password recovery is temporarily unavailable.',503);return createHash('sha256').update(env.AUTH_RECOVERY_SECRET).digest();};
  function setCookie(res,value,seconds) {res.setHeader('Set-Cookie',`${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/api/auth/recovery; Max-Age=${seconds}${secure?'; Secure':''}`);}
  function clear(res) {
    const existing=res.getHeader?.('Set-Cookie') || [];
    res.setHeader('Set-Cookie',[...(Array.isArray(existing)?existing:[existing]),`${COOKIE}=; HttpOnly; SameSite=Strict; Path=/api/auth/recovery; Max-Age=0${secure?'; Secure':''}`]);
  }
  function seal(res,ticket) {
    const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',key(),iv);cipher.setAAD(AAD);
    const encrypted=Buffer.concat([cipher.update(JSON.stringify(ticket)),cipher.final()]);
    const value=Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
    if(value.length>3800) throw authFailure('Unable to store recovery. Please request a new link.',503);
    setCookie(res,value,Math.max(0,Math.floor((ticket.expires-now())/1000)));
  }
  function read(req) {
    key();
    const all=(req.headers.cookie || '').split(';').map(s=>s.trim()).filter(s=>s.startsWith(COOKIE+'='));
    if(all.length!==1) return null;
    try {
      const value=all[0].slice(COOKIE.length+1);if(value.length>3800 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
      const bytes=Buffer.from(value,'base64url'),decipher=createDecipheriv('aes-256-gcm',key(),bytes.subarray(0,12));
      decipher.setAAD(AAD);decipher.setAuthTag(bytes.subarray(12,28));
      const ticket=JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString());
      if(!ticket.userId || !ticket.access || !ticket.refresh || !/^[a-f0-9]{64}$/.test(ticket.hash) ||
        !Number.isFinite(ticket.expires) || ticket.expires<=now() || ticket.expires>now()+TTL*1000) return null;
      return ticket;
    } catch{return null;}
  }
  async function ledger(client,hash,action) {
    const result=await client.rpc('gather_recovery_ticket',{p_hash:hash,p_action:action});
    if(result.error) throw authFailure('Password recovery is temporarily unavailable. Please try again.',503);
    return result.data===true;
  }
  async function restore(req,res) {
    const ticket=read(req);
    if(!ticket) {setCookie(res,'',0);throw authFailure('This recovery session has expired. Request a new link.',401);}
    const client=makeClient(),session=await client.auth.setSession({access_token:ticket.access,refresh_token:ticket.refresh});
    if(session.error) {providerFailure(session.error);throw authFailure('Request a new recovery link.',401);}
    const verified=await client.auth.getUser();providerFailure(verified.error);
    if(verified.data?.user?.id!==ticket.userId || !await ledger(client,ticket.hash,'check')) {
      setCookie(res,'',0);throw authFailure('This recovery link was used or expired. Sign in or request a new link.',401);
    }
    const current=session.data?.session;
    if(current) {ticket.access=current.access_token;ticket.refresh=current.refresh_token;seal(res,ticket);}
    return {client,ticket,user:verified.data.user};
  }
  async function handle(route,req,res,body,json) {
    if(route==='/auth/forgot-password' || route==='/auth/resend-confirmation') {
      if(req.method!=='POST') return json(res,405,{error:'Use POST.'});
      key();const input=authObject(await body(req),['email']);const email=emailInput(input.email);
      limit(req,'email',email);const origin=fixedAuthOrigin(env,port),client=makeClient();
      const result=route.endsWith('forgot-password')
        ? await client.auth.resetPasswordForEmail(email,{redirectTo:origin+'/recover'})
        : await client.auth.resend({type:'signup',email,options:{emailRedirectTo:origin+'/login'}});
      // Address-specific delivery/eligibility errors must not reveal account existence.
      if(result.error && (result.error.status>=500 || result.error.status===429)) providerFailure(result.error);
      return json(res,200,{message:'If this email is eligible, you will receive an email with the next steps. Check your inbox and spam folder.'});
    }
    if(!route.startsWith('/auth/recovery/')) return false;
    key();
    if(route==='/auth/recovery/verify' && req.method==='POST') {
      setCookie(res,'',0); // A failed new link must never reuse a previous account’s recovery.
      const input=authObject(await body(req),['tokenHash']);
      if(typeof input.tokenHash!=='string' || !/^[A-Za-z0-9_-]{20,1024}$/.test(input.tokenHash)) throw authFailure('Invalid recovery link. Request a new one.');
      limit(req,'verify',createHash('sha256').update(input.tokenHash).digest('hex'));
      const client=makeClient(),result=await client.auth.verifyOtp({token_hash:input.tokenHash,type:'recovery'});
      providerFailure(result.error);
      const verified=await client.auth.getUser();providerFailure(verified.error);
      if(!result.data?.session || !verified.data?.user || verified.data.user.id!==result.data.user?.id) throw authFailure('Invalid recovery link. Request a new one.');
      const ticket={userId:verified.data.user.id,hash:randomBytes(32).toString('hex'),access:result.data.session.access_token,
        refresh:result.data.session.refresh_token,expires:now()+TTL*1000};
      if(!await ledger(client,ticket.hash,'issue')) throw authFailure('Unable to start recovery. Request a new link.',503);
      seal(res,ticket);return json(res,200,{ready:true,email:verified.data.user.email});
    }
    if(route==='/auth/recovery/status' && req.method==='GET') {
      const result=await restore(req,res);return json(res,200,{ready:true,email:result.user.email});
    }
    if(route==='/auth/recovery/password' && req.method==='POST') {
      const input=authObject(await body(req),['password','confirmPassword']);
      const password=passwordInput(input.password,true);
      if(password!==input.confirmPassword) throw authFailure('Passwords do not match.');
      const {client,ticket}=await restore(req,res);
      limit(req,'password-change',ticket.userId);
      if(!await ledger(client,ticket.hash,'consume')) throw authFailure('This recovery was already used. Sign in or request a new link.',409);
      let updated;
      try {updated=await client.auth.updateUser({password});providerFailure(updated.error);}
      catch(error) {
        // Release only after an explicit rejection. A lost response may have changed
        // the password; keep the ticket consumed to prevent replay in that case.
        if(updated?.error && updated.error.status<500) await ledger(client,ticket.hash,'release');
        throw error;
      }
      let sessionsRevoked=false;
      try {sessionsRevoked=!(await client.auth.signOut({scope:'global'})).error;} catch {}
      sessionCookies.clear(res);
      clear(res);
      return json(res,200,{ok:true,sessionsRevoked});
    }
    return json(res,405,{error:'Unsupported recovery operation.'});
  }
  return {handle,enabled,clear};
}
