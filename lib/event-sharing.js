// Sharing uses the caller's verified Supabase client. SQL derives auth.uid().
import { userId, requestId } from './friends.js';
const fail = (message, status, code) => Object.assign(Error(message), {status, code});
export function eventId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value) || BigInt(value)>9223372036854775807n)
    throw fail('Invalid event ID.',400);
  return value;
}
function checked(result) {
  if (!result.error) return result.data;
  const {code} = result.error;
  const databaseCode = /^[A-Z0-9]{5,10}$/.test(code || '') ? code : 'UNKNOWN';
  // Retain only the provider code for server diagnostics, never its messages/data.
  const failure = (message, status, publicCode) =>
    Object.assign(fail(message, status, publicCode), {databaseCode});
  if (['PGRST202','PGRST204','PGRST205','42883','42P01','42703'].includes(code))
    throw failure('Sharing database setup is incomplete. Review the sharing migration and Supabase schema cache.',503,'SHARING_SETUP_REQUIRED');
  if (code === '42501') throw failure('You can only send events to accepted Gather friends.',403);
  if (code === '23503') throw failure('The event or person is no longer available.',404);
  if (code === '22023') throw failure('Invalid share request.',400);
  if (code === '23505') throw failure('This request ID was already used for a different share.',409);
  throw failure('Sharing is temporarily unavailable. Please try again.',503,'SHARING_UNAVAILABLE');
}
export async function shareEvent(client, id, input) {
  eventId(id);
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    !['native','copy_link','in_app'].includes(input.channel) ||
    Object.keys(input).sort().join(',') !== (input.channel === 'in_app' ? 'channel,recipientId,requestId' : 'channel,requestId'))
    throw fail('Send channel, requestId and a recipientId only for in-app shares.',400);
  const recipient = input.channel === 'in_app' ? userId(input.recipientId) : null;
  const key = userId(input.requestId);
  const row = checked(await client.rpc('gather_share_event', {
    p_event_id:id, p_channel:input.channel, p_recipient:recipient, p_request_id:key,
  }));
  const result = Array.isArray(row) ? row[0] : row;
  if (!result || typeof result.interaction_id !== 'string') throw fail('Unable to confirm the share. Retry the same send.',503);
  return {interactionId:requestId(result.interaction_id)};
}
export async function receivedShares(client, query) {
  for (const key of query.keys()) if (!['after','limit'].includes(key) || query.getAll(key).length !== 1)
    throw fail('Invalid shared-events query.',400);
  const rawLimit = query.get('limit') || '20';
  if (!/^[1-9]\d?$/.test(rawLimit) || Number(rawLimit)>50) throw fail('Choose a page size from 1 to 50.',400);
  const limit=Number(rawLimit), after=query.has('after') ? requestId(query.get('after')) : null;
  const rows = checked(await client.rpc('gather_received_event_shares',{p_after:after,p_limit:limit+1}));
  if (!Array.isArray(rows)) throw fail('Unable to load shared events.',503);
  const shares=rows.slice(0,limit).map(row=>({
    id:requestId(row.interaction_id), eventId:eventId(row.event_id),
    eventName:String(row.event_name || 'Event unavailable').slice(0,200),
    senderName:String(row.sender_name || 'Gather member').slice(0,80),
    createdAt:row.shared_at,
  }));
  if (shares.some(row=>typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt))))
    throw fail('Unable to read shared events.',503);
  return {shares,nextCursor:rows.length>limit ? shares.at(-1).id : null};
}
