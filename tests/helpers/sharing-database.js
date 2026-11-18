import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
export const A='11111111-1111-4111-8111-111111111111', B='22222222-2222-4222-8222-222222222222', C='33333333-3333-4333-8333-333333333333';
export const key = n => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12,'0')}`;
export async function sharingDatabase({migrate=true}={}) {
  const db=new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth,public to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
    create table public."User"("UserID" uuid primary key references auth.users(id),"Username" text,"IsPrivate" boolean default false,"UserFirstName" text,"UserLastName" text);
    create table public."Events"("EventID" bigint primary key,"EventName" text);
    create table public."Friends"("UserAID" uuid,"UserBID" uuid,unique("UserAID","UserBID"));
    create table public."EventInteractionLog"(
      "InteractionID" bigint generated always as identity primary key,
      "UserID" uuid not null references public."User"("UserID"),
      "EventID" bigint not null references public."Events"("EventID"),
      "InteractionType" text not null, "RecipientUserID" uuid references public."User"("UserID"),
      created_at timestamptz not null default now(),
      constraint fixture_recipient_check check (("InteractionType"='view' and "RecipientUserID" is null) or ("InteractionType"='share' and "RecipientUserID" is not null))
    );
    alter table public."EventInteractionLog" enable row level security;
    grant select on public."Events" to anon,authenticated;
    grant insert ("UserID","EventID","InteractionType","RecipientUserID") on public."EventInteractionLog" to authenticated;
    grant usage on sequence public."EventInteractionLog_InteractionID_seq" to authenticated;
    create policy gather_event_view_insert on public."EventInteractionLog" for insert to authenticated with check (
      "UserID"=auth.uid() and "InteractionType"='view' and "RecipientUserID" is null
    );
    insert into auth.users values ('${A}'),('${B}'),('${C}');
    insert into public."User" values ('${A}','alex',false,'Alex','Sender'),('${B}','blair',true,'PRIVATE NAME',''),('${C}','casey',false,'Casey','Other');
    insert into public."Events" values (1,'Jazz <friends>'),(9007199254740993,'Big event'),(9223372036854775807,'Largest event');
    insert into public."Friends" values ('${A}','${B}');
    insert into public."EventInteractionLog" ("UserID","EventID","InteractionType") values ('${A}',1,'view');
    insert into public."EventInteractionLog" ("UserID","EventID","InteractionType","RecipientUserID") values ('${A}',1,'share','${B}');
  `);
  const friendships=await readFile(new URL('../../supabase/migrations/20261106000000_friendships.sql',import.meta.url),'utf8');
  for(const name of ['gather_lock_friend_pair','remove_friend']) {
    const source=friendships.match(new RegExp(`create function public\\.${name}\\([\\s\\S]*?\\$\\$;`))[0];
    await db.exec(source);
  }
  const migration=await readFile(new URL('../../supabase/migrations/20261119000000_event_sharing.sql',import.meta.url),'utf8');
  const repair=await readFile(new URL('../../supabase/repairs/20261120000000_complete_okr_sharing.sql',import.meta.url),'utf8');
  if(migrate) await db.exec(repair);
  // SET ROLE and JWT subject model what Supabase supplies; never run this helper on a remote DB.
  let queue=Promise.resolve();
  const asUser=(actor,sql,params=[])=>{
    const result=queue.then(async()=>{
      await db.exec('begin');
      try {
        await db.query("select set_config('request.jwt.claim.sub',$1,true)",[actor || '']);
        await db.exec('set local role '+(actor?'authenticated':'anon'));
        const rows=await db.query(sql,params); await db.exec('commit'); return rows.rows;
      } catch(error) {await db.exec('rollback'); throw error;}
    });
    queue=result.catch(()=>{});return result;
  };
  const send=(actor,id,channel,recipient,request)=>asUser(actor,'select * from public.gather_share_event($1::bigint,$2::text,$3::uuid,$4::uuid)',[id,channel,recipient,request]);
  const inbox=(actor,after=null,limit=21)=>asUser(actor,'select * from public.gather_received_event_shares($1::bigint,$2::integer)',[after,limit]);
  return {db,asUser,send,inbox,migration,repair};
}
