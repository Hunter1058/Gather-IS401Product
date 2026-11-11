// All friend actions run with the verified account client, never a service key.
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const states = new Set(['none', 'outgoing_pending', 'incoming_pending', 'friends']);
const fail = (message, status, code) => Object.assign(Error(message), { status, code });
export function userId(value) {
  if (typeof value !== 'string' || !uuidPattern.test(value)) throw fail('Invalid person ID.', 400);
  return value.toLowerCase();
}
export function requestId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n)
    throw fail('Invalid request ID.', 400);
  return value;
}
export function friendBody(input, recipient = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).length !== (recipient ? 1 : 0) ||
      (recipient && !Object.hasOwn(input, 'recipientId')))
    throw fail(recipient ? 'Send only recipientId.' : 'No additional fields are allowed.', 400);
  return recipient ? userId(input.recipientId) : undefined;
}
function checked(result) {
  const error = result.error;
  if (!error) return result.data;
  if (['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(error.code))
    throw fail('Friends are not ready yet. Please try again later.', 503, 'FRIENDS_SETUP_REQUIRED');
  if (error.code === '42501') throw fail('You cannot change that request.', 403);
  if (error.code === '23503') throw fail('That person is no longer available.', 404);
  if (['22023', '23505'].includes(error.code))
    throw fail('The relationship changed. Refresh its status before trying again.', 409, 'FRIEND_STATE_CHANGED');
  throw fail('Friends are temporarily unavailable. Please try again.', 503);
}
function person(row) {
  const id = userId(row.user_id);
  if (!states.has(row.relationship)) throw fail('Unable to read friendship status. Please retry.', 503);
  const pending = row.relationship.endsWith('_pending');
  const idOfRequest = pending ? requestId(row.request_id) : null;
  const username = String(row.username || '').trim().slice(0, 60) || null;
  const isPrivate = row.is_private !== false;
  const name = isPrivate ? (username ? '@' + username : 'Private profile')
    : String(row.display_name || '').trim().slice(0, 80) || 'Member ' + id.slice(0, 8);
  return { id, name, username, isPrivate, photoUrl: isPrivate ? null : row.photo_url ?? null,
    relationship: row.relationship, requestId: idOfRequest,
    mutualFriends: Math.max(0, Number(row.mutual_friends) || 0),
    sharedEvents: Math.max(0, Number(row.shared_events) || 0),
    connectionDegree: !isPrivate && [2, 3].includes(row.connection_degree) ? row.connection_degree : null,
    sharedInterests: !isPrivate ? Math.max(0, Number(row.shared_interests) || 0) : 0 };
}
export async function people(client, query) {
  const allowed = new Set(['after', 'limit', 'personId', 'section', 'search', 'q']);
  for (const key of query.keys())
    if (!allowed.has(key) || query.getAll(key).length !== 1) throw fail('Invalid people query.', 400);
  const rawLimit = query.get('limit') || '24';
  if (!/^[1-9]\d?$/.test(rawLimit) || Number(rawLimit) > 50) throw fail('Choose a page size from 1 to 50.', 400);
  const limit = Number(rawLimit);
  const after = query.has('after') ? userId(query.get('after')) : null;
  const target = query.has('personId') ? userId(query.get('personId')) : null;
  if (target && after) throw fail('A person lookup cannot include a page cursor.', 400);
  if (query.has('search') && query.has('q')) throw fail('Send only one search query.', 400);
  const section = query.get('section');
  const search = (query.get('search') || query.get('q') || '').trim();
  if ((section && !['friends', 'search', 'requests'].includes(section)) || search.length > 254 || (target && (section || search)))
    throw fail('Invalid directory filter.', 400);
  const recommendations = section === 'search' && !search;
  const rows = checked(await client.rpc(recommendations ? 'get_friend_recommendations' : section ? 'get_friend_directory' : 'search_friend_people', {
    p_limit: target ? 1 : limit + 1, p_after: after,
    ...(recommendations ? {} : section ? { p_section: section, p_search: search } : { p_person_id: target, p_query: search.replace(/^@/, '') || null }),
  }));
  if (!Array.isArray(rows)) throw fail('Unable to read people. Please retry.', 503);
  let mapped;
  try { mapped = rows.slice(0, target ? 1 : limit).map(person); }
  catch { throw fail('Unable to read friendship status. Please retry.', 503); }
  if (target && !mapped.length) throw fail('That person is no longer available.', 404);
  return { people: mapped, nextCursor: !target && rows.length > limit ? mapped.at(-1).id : null };
}
async function currentPerson(client, id) {
  return (await people(client, new URLSearchParams({ personId: id }))).people[0];
}
export async function sendRequest(client, actor, recipient) {
  if (recipient === actor) throw fail('Choose another person.', 400);
  checked(await client.rpc('send_friend_request', { p_recipient_user_id: recipient }));
  // IDs from the old composite-returning write RPC may be JSON numbers. Never
  // coerce them: the read RPC supplies the pending request ID as SQL text.
  return currentPerson(client, recipient);
}
export async function cancelRequest(client, actor, id) {
  const data = checked(await client.rpc('cancel_friend_request', { p_request_id: requestId(id) }));
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || row.RequesterUserID !== actor) throw fail('Unable to confirm the cancellation. Refresh its status.', 503);
  return currentPerson(client, userId(row.RecipientUserID));
}
export async function removeFriend(client, actor, other) {
  if (actor === other) throw fail('Choose another person.', 400);
  checked(await client.rpc('remove_friend', { p_other_user_id: other }));
  return currentPerson(client, other);
}

export async function respondRequest(client, actor, id, accept) {
  const data = checked(await client.rpc('respond_to_friend_request', {
    p_request_id: requestId(id), p_accept: accept,
  }));
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || row.RecipientUserID !== actor) throw fail('Unable to confirm the response. Refresh its status.', 503);
  return currentPerson(client, userId(row.RequesterUserID));
}

export async function connections(client, actor, target, query) {
  target=userId(target);
  if (target===actor) throw fail('Choose another person.',400);
  for (const key of query.keys()) if (!['kind','after','limit'].includes(key) || query.getAll(key).length!==1)
    throw fail('Invalid connections query.',400);
  const kind=query.get('kind');
  if (!['friends','events','interests'].includes(kind)) throw fail('Choose a connections section.',400);
  const raw=query.get('limit') || '10';
  if (!/^[1-9]\d?$/.test(raw) || Number(raw)>50) throw fail('Choose a page size from 1 to 50.',400);
  const limit=Number(raw), after=query.has('after') ? (kind==='friends'?userId(query.get('after')):requestId(query.get('after'))) : null;
  const profile=await currentPerson(client,target);
  if (profile.isPrivate) return {person:profile,kind,items:[],nextCursor:null};
  const rows=checked(await client.rpc('get_friend_connections',{p_person_id:target,p_kind:kind,p_limit:limit+1,p_after:after}));
  if (!Array.isArray(rows)) throw fail('Unable to load shared connections. Please retry.',503);
  let items;
  try { items=rows.slice(0,limit).map(row=>({
    id:kind==='friends'?userId(row.item_id):requestId(row.item_id),
    name:String(row.label || '').slice(0,200) || 'Unavailable',
    username:kind==='friends' ? String(row.username || '').trim().slice(0,60) || null : null,
    date:kind==='events' && /^\d{4}-\d{2}-\d{2}$/.test(row.event_date || '') ? row.event_date : null,
    location:kind==='events' ? String(row.event_location || '').slice(0,200) || null : null,
  })); } catch { throw fail('Unable to read shared connections. Please retry.',503); }
  return {person:profile,kind,items,nextCursor:rows.length>limit?items.at(-1).id:null};
}
