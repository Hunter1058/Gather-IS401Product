import { createHash } from 'node:crypto';
export const authFailure=(message,status=400,code)=>Object.assign(Error(message),{status,code});
export function authObject(value, allowed) {
  if (!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(k=>!allowed.includes(k)))
    throw authFailure('Invalid account request.');
  return value;
}
export function emailInput(value) {
  if (typeof value!=='string') throw authFailure('Enter a valid email address.');
  const email=value.trim().toLowerCase();
  if (email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw authFailure('Enter a valid email address.');
  return email;
}
export function passwordInput(value, creating=false) {
  if (typeof value!=='string' || value.length<(creating?8:1) || Buffer.byteLength(value)>4096)
    throw authFailure(creating?'Use a password of at least 8 characters (maximum 4096 bytes).':'Enter your password.');
  return value; // Never trim/normalize a password or apply signup rules to login.
}
export function signupProfile(value) {
  if (value===undefined) return undefined; // Legacy callers; new page always sends profile.
  authObject(value,['firstName','lastName','username','isPrivate','categoryIds']);
  const {firstName,lastName,username,isPrivate,categoryIds}=value;
  if (typeof firstName!=='string' || !firstName.trim() || firstName.trim().length>60 ||
    typeof lastName!=='string' || lastName.trim().length>60 || typeof username!=='string' ||
    !/^[a-z0-9_]{3,30}$/.test(username) || typeof isPrivate!=='boolean' ||
    !Array.isArray(categoryIds) || categoryIds.length>100 || categoryIds.some(id=>typeof id!=='string' ||
      !/^[1-9]\d{0,18}$/.test(id) || BigInt(id)>9223372036854775807n))
    throw authFailure('Enter valid profile details and interests.');
  const profile={firstName:firstName.trim(),lastName:lastName.trim(),username,isPrivate,categoryIds:[...new Set(categoryIds)]};
  // Prevent oversized Auth metadata/JWT cookies. Photos are never put in metadata.
  if (Buffer.byteLength(JSON.stringify(profile))>1200) throw authFailure('Choose fewer interests for now. You can add more in Profile settings.');
  return profile;
}
export function providerFailure(error, login=false) {
  if (!error) return;
  if (error.status===429 || ['over_request_rate_limit','over_email_send_rate_limit'].includes(error.code))
    throw authFailure('Too many attempts. Please wait before trying again.',429);
  if (error.status>=500 || /Fetch|Timeout/.test(error.name || '')) throw authFailure('Account service is temporarily unavailable. Please try again.',503);
  if (login) throw authFailure('Email or password is incorrect, or the account is not ready to sign in. Confirm your email or use account help.',400);
  if (['weak_password','same_password'].includes(error.code)) throw authFailure('Choose a different password that meets the account password requirements.',400);
  throw authFailure('Unable to complete that account request. Try again or request a new email link.',400);
}
export function fixedAuthOrigin(env,port=3000) {
  const raw=env.APP_ORIGIN || (!(env.VERCEL || env.NODE_ENV==='production') ? `http://localhost:${port}` : '');
  try {
    const url=new URL(raw);
    if (url.username || url.password || url.search || url.hash || !['','/'].includes(url.pathname) ||
      (url.protocol!=='https:' && !(url.protocol==='http:' && ['localhost','127.0.0.1'].includes(url.hostname)))) throw Error();
    return url.origin;
  } catch {throw authFailure('Account email service is temporarily unavailable.',503);}
}
// Best effort per-worker guard; Supabase/platform limits are still required.
export function authLimiter(now=Date.now) {
  const entries=new Map();
  return (req,action,email='')=>{
    const time=now(), ip=req.socket?.remoteAddress || 'unknown';
    for(const [key,entry] of entries) if(entry.expires<=time) entries.delete(key);
    const window=action==='email'?60000:15*60000;
    const keys=[[`ip:${action}:${ip}`,action==='email'?20:100],[`account:${action}:${createHash('sha256').update(email).digest('hex')}`,action==='email'?3:20]];
    if(entries.size>10000) throw authFailure('Too many attempts. Please try again later.',429);
    for(const [key,limit] of keys) if((entries.get(key)?.count || 0)>=limit) throw authFailure('Too many attempts. Please wait before trying again.',429);
    for(const [key] of keys) {const entry=entries.get(key)||{count:0,expires:time+window};entry.count++;entries.set(key,entry);}
  };
}
