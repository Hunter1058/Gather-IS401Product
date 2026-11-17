// Use strings throughout: PostgreSQL bigint exceeds JavaScript's safe integers.
export async function logEventView(client, userId, eventId, input) {
  if (typeof eventId !== 'string' || !/^[1-9]\d{0,18}$/.test(eventId) || BigInt(eventId) > 9223372036854775807n)
    throw Object.assign(Error('Invalid event ID.'), { status: 400 });
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length)
    throw Object.assign(Error('Send an empty object for an event view.'), { status: 400 });
  const event = await client.from('Events').select('EventID::text').eq('EventID', eventId).maybeSingle();
  if (event.error) throw event.error;
  if (!event.data) throw Object.assign(Error('This event is no longer available.'), { status: 404 });
  // No returning SELECT: analytics does not require permission to read logs.
  const result = await client.from('EventInteractionLog').insert({
    UserID: userId, EventID: eventId, InteractionType: 'view', RecipientUserID: null,
  });
  if (result.error) throw result.error;
}
